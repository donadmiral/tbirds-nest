import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
const ref = name => ({ Ref: name }), attr = (name, property) => ({ 'Fn::GetAtt': [name, property] }), sub = value => ({ 'Fn::Sub': value });
function signingImport(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some(key => key !== 'signingStoreBootstrap')) throw new Error('Invalid infrastructure template options');
  const value = options.signingStoreBootstrap;
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['phase', 'seedObjectKey'].includes(key))
    || !['stage', 'activate'].includes(value.phase)
    || typeof value.seedObjectKey !== 'string' || !/^_bootstrap\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.json$/.test(value.seedObjectKey)) {
    throw new Error('Signing-store bootstrap requires phase stage|activate and a private _bootstrap/<name>.json seed object key');
  }
  return value;
}
// The caller uploads the seed privately first. Stage adds a distinct store;
// activate is selected only after its control-plane Status is READY. Reuse the
// exact same seed key in both phases: CloudFront cannot update ImportSource.
// Neither phase reads the seed or embeds signing values in the template.
export async function liveInfrastructureTemplate(options = {}) {
  const bootstrap = signingImport(options);
  const FunctionCode = await readFile(new URL('./viewer-request.js', import.meta.url), 'utf8');
  const policy = (suffix, ttl, maximum) => ({ Type: 'AWS::CloudFront::CachePolicy', Properties: { CachePolicyConfig: {
    Name: sub('${AWS::StackName}-' + suffix), DefaultTTL: ttl, MaxTTL: maximum, MinTTL: 0,
    ParametersInCacheKeyAndForwardedToOrigin: { EnableAcceptEncodingBrotli: true, EnableAcceptEncodingGzip: true,
      CookiesConfig: { CookieBehavior: 'none' }, HeadersConfig: { HeaderBehavior: 'none' }, QueryStringsConfig: { QueryStringBehavior: 'none' } },
  } } });
  const behavior = cache => ({ TargetOriginId: 'PrivateLiveStorage', ViewerProtocolPolicy: 'https-only', AllowedMethods: ['GET', 'HEAD', 'OPTIONS'],
    CachedMethods: ['GET', 'HEAD'], Compress: true, CachePolicyId: ref(cache), ResponseHeadersPolicyId: ref('PlaybackHeaders'),
    FunctionAssociations: [{ EventType: 'viewer-request', FunctionARN: attr('ViewerAuthorization', 'FunctionMetadata.FunctionARN') }] });
  const template = {
    AWSTemplateFormatVersion: '2010-09-09', Description: 'Private Platinum Live HLS storage and authenticated shared CDN delivery.',
    Parameters: {
      DailyAccountId: { Type: 'String', Default: '291871421005', AllowedPattern: '\\d{12}', Description: 'Daily AWS account, verified against its custom S3 guide before deployment.' },
      DailyExternalId: { Type: 'String', MinLength: 1, MaxLength: 63, AllowedPattern: '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', Description: 'Exact Daily domain name (the subdomain before .daily.co), not the domain UUID.' },
    },
    Resources: {
      LiveBucket: { Type: 'AWS::S3::Bucket', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: {
        PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
        OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] }, VersioningConfiguration: { Status: 'Enabled' },
        BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
        LifecycleConfiguration: { Rules: [{ Id: 'AbandonedUploadsAndSupersededManifests', Status: 'Enabled',
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 }, NoncurrentVersionExpiration: { NoncurrentDays: 7 } }] },
      } },
      DailyWriter: { Type: 'AWS::IAM::Role', Properties: {
        MaxSessionDuration: 43200,
        AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'sts:AssumeRole',
          Principal: { AWS: sub('arn:aws:iam::${DailyAccountId}:root') }, Condition: { StringEquals: { 'sts:ExternalId': ref('DailyExternalId') } } }] },
        Policies: [{ PolicyName: 'PlatinumLiveOnly', PolicyDocument: { Version: '2012-10-17', Statement: [
          { Effect: 'Allow', Action: ['s3:GetBucketLocation', 's3:ListBucket', 's3:ListBucketVersions', 's3:ListBucketMultipartUploads'], Resource: attr('LiveBucket', 'Arn') },
          { Effect: 'Allow', Action: ['s3:PutObject', 's3:GetObject', 's3:GetObjectVersion', 's3:DeleteObject', 's3:AbortMultipartUpload', 's3:ListMultipartUploadParts'],
            Resource: sub('${LiveBucket.Arn}/live/*') },
          { Effect: 'Allow', Action: 's3:PutObject', Resource: sub('${LiveBucket.Arn}/daily-co-test-upload.txt') },
        ] } }],
      } },
      SigningKeys: { Type: 'AWS::CloudFront::KeyValueStore', Properties: { Name: sub('${AWS::StackName}-signing'), Comment: 'Private playback signing keys, no user data.' } },
      ViewerAuthorization: { Type: 'AWS::CloudFront::Function', Properties: { Name: sub('${AWS::StackName}-authorize'), AutoPublish: true, FunctionCode,
        FunctionConfig: { Runtime: 'cloudfront-js-2.0', Comment: 'Authorize every HLS object before shared-cache lookup.',
          KeyValueStoreAssociations: [{ KeyValueStoreARN: attr('SigningKeys', 'Arn') }] } } },
      OriginAccess: { Type: 'AWS::CloudFront::OriginAccessControl', Properties: { OriginAccessControlConfig: { Name: sub('${AWS::StackName}-storage'),
        OriginAccessControlOriginType: 's3', SigningBehavior: 'always', SigningProtocol: 'sigv4' } } },
      SegmentCache: policy('segments', 3600, 86400), ManifestCache: policy('manifests', 1, 2),
      PlaybackHeaders: { Type: 'AWS::CloudFront::ResponseHeadersPolicy', Properties: { ResponseHeadersPolicyConfig: {
        Name: sub('${AWS::StackName}-playback'), CorsConfig: { AccessControlAllowCredentials: false, AccessControlAllowHeaders: { Items: ['Range', 'Origin', 'Accept'] },
          AccessControlAllowMethods: { Items: ['GET', 'HEAD', 'OPTIONS'] }, AccessControlAllowOrigins: { Items: ['*'] },
          AccessControlExposeHeaders: { Items: ['Content-Length', 'Content-Range', 'Accept-Ranges'] }, OriginOverride: true },
        SecurityHeadersConfig: { ContentTypeOptions: { Override: true }, ReferrerPolicy: { ReferrerPolicy: 'no-referrer', Override: true } },
        CustomHeadersConfig: { Items: [{ Header: 'Cache-Control', Value: 'private, max-age=1', Override: true }] },
      } } },
      LiveCdn: { Type: 'AWS::CloudFront::Distribution', Properties: { DistributionConfig: { Enabled: true, HttpVersion: 'http2and3', IPV6Enabled: true,
        Comment: 'Platinum Live. All objects require short-lived path capabilities.', PriceClass: 'PriceClass_All',
        Origins: [{ Id: 'PrivateLiveStorage', DomainName: attr('LiveBucket', 'RegionalDomainName'), OriginAccessControlId: ref('OriginAccess'), S3OriginConfig: { OriginAccessIdentity: '' } }],
        DefaultCacheBehavior: behavior('SegmentCache'), CacheBehaviors: [{ PathPattern: '*.m3u8', ...behavior('ManifestCache') }],
        CustomErrorResponses: [{ ErrorCode: 403, ErrorCachingMinTTL: 1 }, { ErrorCode: 404, ErrorCachingMinTTL: 1 }],
        ViewerCertificate: { CloudFrontDefaultCertificate: true },
      } } },
      LiveBucketPolicy: { Type: 'AWS::S3::BucketPolicy', Properties: { Bucket: ref('LiveBucket'), PolicyDocument: { Version: '2012-10-17', Statement: [
        { Sid: 'CdnReadOnly', Effect: 'Allow', Principal: { Service: 'cloudfront.amazonaws.com' }, Action: 's3:GetObject', Resource: sub('${LiveBucket.Arn}/live/*'),
          Condition: { StringEquals: { 'AWS:SourceArn': sub('arn:aws:cloudfront::${AWS::AccountId}:distribution/${LiveCdn}') } } },
        { Sid: 'RequireTls', Effect: 'Deny', Principal: '*', Action: 's3:*', Resource: [attr('LiveBucket', 'Arn'), sub('${LiveBucket.Arn}/*')], Condition: { Bool: { 'aws:SecureTransport': 'false' } } },
      ] } } },
    },
    Outputs: { Bucket: { Value: ref('LiveBucket') }, Region: { Value: ref('AWS::Region') }, DailyRoleArn: { Value: attr('DailyWriter', 'Arn') },
      CdnOrigin: { Value: sub('https://${LiveCdn.DomainName}') }, SigningStoreArn: { Value: attr('SigningKeys', 'Arn') },
      DistributionId: { Value: ref('LiveCdn') }, ViewerFunctionName: { Value: sub('${AWS::StackName}-authorize') },
      ViewerFunctionArn: { Value: attr('ViewerAuthorization', 'FunctionMetadata.FunctionARN') } },
  };
  if (bootstrap) {
    template.Resources.SigningKeysImported = { Type: 'AWS::CloudFront::KeyValueStore', Properties: {
      Name: sub('${AWS::StackName}-signing-v1'), Comment: 'Private playback signing keys imported from the private bootstrap seed.',
      ImportSource: { SourceArn: sub('${LiveBucket.Arn}/' + bootstrap.seedObjectKey), SourceType: 'S3' },
    } };
    if (bootstrap.phase === 'activate') {
      template.Resources.ViewerAuthorization.Properties.FunctionConfig.KeyValueStoreAssociations = [
        { KeyValueStoreARN: attr('SigningKeysImported', 'Arn') },
      ];
      template.Outputs.SigningStoreArn.Value = attr('SigningKeysImported', 'Arn');
    }
  }
  return template;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values, positionals } = parseArgs({ options: {
    'signing-import-phase': { type: 'string' }, 'signing-import-key': { type: 'string' },
  }, allowPositionals: true });
  if (positionals.length > 1) throw new Error('Provide only one output template path');
  const importing = values['signing-import-phase'] !== undefined || values['signing-import-key'] !== undefined;
  if (importing && positionals.length !== 1) throw new Error('Signing-store bootstrap requires an explicit output template path');
  const options = importing ? { signingStoreBootstrap: { phase: values['signing-import-phase'], seedObjectKey: values['signing-import-key'] } } : {};
  const destination = positionals[0] || fileURLToPath(new URL('./live-cloudformation.json', import.meta.url));
  await writeFile(destination, JSON.stringify(await liveInfrastructureTemplate(options), null, 2) + '\n', { mode: 0o600 });
}
