import assert from 'node:assert/strict';import {test} from 'node:test';import {readFile} from 'node:fs/promises';
import {transcriptionTaskTemplate} from '../task-template.mjs';
const template=transcriptionTaskTemplate(),resources=template.Resources,task=resources.Task.Properties,container=task.ContainerDefinitions[0];
test('template deploys no running service or scheduler, and stores only a disabled bounded task definition',async()=>{
 assert.deepEqual(JSON.parse(await readFile(new URL('../task-cloudformation.json',import.meta.url))),template);
 assert.ok(!Object.values(resources).some(x=>['AWS::ECS::Service','AWS::Events::Rule','AWS::Scheduler::Schedule'].includes(x.Type)));
 assert.equal(task.Cpu,'1024');assert.equal(task.Memory,'2048');assert.equal(template.Parameters.ExecutionEnabled.Default,'false');assert.equal(container.StopTimeout,30);
 assert.equal(container.ReadonlyRootFilesystem,true);assert.equal(container.User,'1000:1000');assert.deepEqual(container.LinuxParameters.Capabilities.Drop,['ALL']);assert.equal(container.PortMappings,undefined);
 assert.deepEqual(container.Image,{'Fn::Sub':'${ImageRepositoryUri}@${ImageDigest}'});assert.equal(container.Name,'transcription');
 assert.deepEqual(resources.WorkerSecurityGroup.Properties.SecurityGroupIngress,[]);assert.equal(resources.WorkerSecurityGroup.Properties.SecurityGroupEgress[0].ToPort,443);
 for(const name of ['ClusterArn','TaskDefinitionArn','TaskRoleArn','TaskExecutionRoleArn','SecurityGroupId','SubnetIds','ContainerName','QueuePeekUrl'])assert.ok(template.Outputs[name]);
});
test('task credentials are limited to exact jobs, private source/result keys and the reviewed data role',()=>{
 const statements=resources.TaskRole.Properties.Policies[0].PolicyDocument.Statement;
 assert.ok(!JSON.stringify(statements).includes('secretsmanager:'));assert.ok(!JSON.stringify(statements).includes('transcribe:Delete'));
 const jobs=statements.find(s=>Array.isArray(s.Action)&&s.Action.includes('transcribe:StartTranscriptionJob'));
 assert.equal(jobs.Resource['Fn::Sub'],'arn:${AWS::Partition}:transcribe:us-east-2:${AWS::AccountId}:transcription-job/pc-live-caption-*');
 const objects=statements.find(s=>Array.isArray(s.Action)&&s.Action.includes('s3:PutObject'));assert.equal(objects.Resource.length,2);
 assert.deepEqual(objects.Resource.map(x=>x['Fn::Sub']),['arn:${AWS::Partition}:s3:::${AudioBucketName}/transcription/*/source.flac','arn:${AWS::Partition}:s3:::${AudioBucketName}/transcription/*/result.json']);
 const pass=statements.find(s=>s.Action==='iam:PassRole');assert.deepEqual(pass.Resource,{Ref:'DataAccessRoleArn'});assert.equal(pass.Condition.StringEquals['iam:PassedToService'],'transcribe.amazonaws.com');
 assert.deepEqual(container.Secrets,[{Name:'LIVE_TRANSCRIPTION_WORKER_SECRET',ValueFrom:{Ref:'BrokerSecretArn'}}]);
 assert.ok(!container.Environment.some(e=>/SECRET|TOKEN|PASSWORD/.test(e.Name)));assert.ok(!container.Secrets.some(e=>e.Name==='LIVE_TRANSCRIPTION_QUEUE_SECRET'));
 const exec=resources.TaskExecutionRole.Properties.Policies[0].PolicyDocument.Statement.find(s=>s.Action==='secretsmanager:GetSecretValue');assert.deepEqual(exec.Resource,{Ref:'BrokerSecretArn'});
});
