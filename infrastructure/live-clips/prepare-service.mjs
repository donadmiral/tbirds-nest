import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export async function serviceParameters({ digest, desiredCount = 0, alarmTopicArn = '' }) {
  if (!/^sha256:[a-f0-9]{64}$/.test(digest || '') || desiredCount !== 0
    || !/^(?:|arn:aws:sns:us-east-2:518317808503:[A-Za-z0-9_-]+)$/.test(alarmTopicArn)) throw Error('service_inputs_invalid');
  const network = JSON.parse(await readFile(new URL('./production-network.json', import.meta.url), 'utf8'));
  const bootstrap = JSON.parse(await readFile(new URL('./production-bootstrap.json', import.meta.url), 'utf8'));
  const values = { VpcId: network.vpc_id, PublicSubnetIds: network.subnet_ids.join(','),
    ImageRepositoryUri: bootstrap.repository_uri, ImageRepositoryArn: bootstrap.repository_arn,
    ImageDigest: digest, BrokerSecretArn: bootstrap.broker_secret_arn, BrokerKeyArn: bootstrap.broker_key_arn,
    SupabaseProjectRef: 'prlkikhckbifseosbukl', HlsCdnOrigin: 'https://d34dlehokbfej7.cloudfront.net',
    DesiredCount: String(desiredCount), AlarmTopicArn: alarmTopicArn };
  return Object.entries(values).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const name = process.argv[i], value = process.argv[i + 1];
      if (!['--image-digest', '--desired-count', '--alarm-topic-arn', '--output'].includes(name) || name in args || !value) throw Error('invalid_arguments');
      args[name] = value;
    }
    if (!args['--output']) throw Error('output_path_required');
    const parameters = await serviceParameters({ digest: args['--image-digest'],
      desiredCount: args['--desired-count'] === undefined ? 0 : Number(args['--desired-count']),
      alarmTopicArn: args['--alarm-topic-arn'] || '' });
    await writeFile(args['--output'], JSON.stringify(parameters, null, 2) + '\n');
    process.stdout.write('Nonsecret service parameters written; no hosted operation performed.\n');
  } catch { process.stderr.write('service_parameter_generation_failed\n'); process.exitCode = 1; }
}
