import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export async function launcherParameters({ serviceOutputs, enabled = false, alarmTopicArn = '', asr = null }) {
  const account = '518317808503', region = 'us-east-2';
  const outputs = Array.isArray(serviceOutputs) ? Object.fromEntries(serviceOutputs.map(row => [row.OutputKey, row.OutputValue])) : serviceOutputs;
  if (!outputs || typeof outputs !== 'object') throw Error('service_outputs_invalid');
  const required = {
    ClusterArn: new RegExp(`^arn:aws:ecs:${region}:${account}:cluster/[A-Za-z0-9_-]+$`),
    TaskDefinitionArn: new RegExp(`^arn:aws:ecs:${region}:${account}:task-definition/[A-Za-z0-9_-]+:[1-9][0-9]*$`),
    TaskExecutionRoleArn: new RegExp(`^arn:aws:iam::${account}:role/[A-Za-z0-9_+=,.@/-]+$`),
    SecurityGroupId: /^sg-[a-f0-9]{8,17}$/,
  };
  for (const [key, pattern] of Object.entries(required)) if (!pattern.test(outputs[key] || '')) throw Error('service_outputs_invalid');
  if (typeof enabled !== 'boolean' || !new RegExp(`^(?:|arn:aws:sns:${region}:${account}:[A-Za-z0-9_-]+)$`).test(alarmTopicArn)) throw Error('launcher_parameters_invalid');
  const network = JSON.parse(await readFile(new URL('./production-network.json', import.meta.url), 'utf8'));
  const bootstrap = JSON.parse(await readFile(new URL('./production-bootstrap.json', import.meta.url), 'utf8'));
  const values = { RendererClusterArn: outputs.ClusterArn, RendererTaskDefinitionArn: outputs.TaskDefinitionArn,
    RendererExecutionRoleArn: outputs.TaskExecutionRoleArn, RendererSecurityGroupId: outputs.SecurityGroupId,
    RendererSubnetIds: network.subnet_ids.join(','), QueueKeyArn: bootstrap.broker_key_arn,
    SupabaseProjectRef: 'prlkikhckbifseosbukl', ScheduleEnabled: String(enabled), AsrEnabled: 'false', AlarmTopicArn: alarmTopicArn };
  if (asr !== null) {
    const keys = ['AsrClusterArn', 'AsrTaskDefinitionArn', 'AsrExecutionRoleArn', 'AsrTaskRoleArn', 'AsrSecurityGroupId', 'AsrSubnetIds', 'AsrQueueSecretArn', 'AsrQueueKeyArn'];
    if (typeof asr !== 'object' || Array.isArray(asr) || Object.keys(asr).length !== keys.length
        || keys.some(key => typeof asr[key] !== 'string' || !asr[key])) throw Error('asr_parameters_invalid');
    Object.assign(values, asr, { AsrEnabled: 'true' });
    // CloudFormation and the Lambda independently validate these identifiers.
    if (keys.filter(key => key.endsWith('Arn')).some(key => !asr[key].startsWith('arn:aws:') || !asr[key].includes(':' + account + ':'))) throw Error('asr_parameters_invalid');
  }
  return Object.entries(values).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i], value = process.argv[i + 1];
      if (!['--service-outputs', '--enabled', '--alarm-topic-arn', '--asr-config', '--output'].includes(key) || key in args || !value) throw Error('arguments_invalid');
      args[key] = value;
    }
    if (!args['--service-outputs'] || !args['--output'] || !['true', 'false', undefined].includes(args['--enabled'])) throw Error('arguments_invalid');
    const parameters = await launcherParameters({
      serviceOutputs: JSON.parse(await readFile(args['--service-outputs'], 'utf8')), enabled: args['--enabled'] === 'true',
      alarmTopicArn: args['--alarm-topic-arn'] || '', asr: args['--asr-config'] ? JSON.parse(await readFile(args['--asr-config'], 'utf8')) : null,
    });
    await writeFile(args['--output'], JSON.stringify(parameters, null, 2) + '\n');
    process.stdout.write('Nonsecret launcher parameters written; schedule defaults disabled.\n');
  } catch { process.stderr.write('launcher_parameter_generation_failed\n'); process.exitCode = 1; }
}
