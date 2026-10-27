'use strict';
// Inert until every REVIEW_REQUIRED value has been replaced and reviewed.
// The caller's IAM identity can bypass this wrapper; it is not an IAM boundary.
const { spawnSync } = require('node:child_process');

const config = Object.freeze({
  profile: 'scope-signin', region: 'us-east-1',
  cluster: 'arn:aws:ecs:us-east-1:309490997821:cluster/scope-prod-cluster',
  taskDefinition: 'REVIEW_REQUIRED_EXACT_TASK_DEFINITION_ARN',
  image: 'REVIEW_REQUIRED_PINNED_IMAGE_DIGEST',
  taskRole: 'REVIEW_REQUIRED_TASK_ROLE_ARN',
  executionRole: 'REVIEW_REQUIRED_EXECUTION_ROLE_ARN',
  subnetIds: Object.freeze(['REVIEW_REQUIRED_SUBNET_ID']),
  securityGroupIds: Object.freeze(['REVIEW_REQUIRED_SECURITY_GROUP_ID']),
  containerName: 'provisioner'
});
const entryPoint = ['/bin/sh', '/app/services/api/docker/provision-uade-entrypoint.sh'];
function fail(message) { throw new Error(message); }
function fixedConfiguration(c) {
  if (JSON.stringify(c).includes('REVIEW_REQUIRED')) fail('CONFIGURATION_NOT_REVIEWED');
  if (!/^arn:aws:ecs:us-east-1:309490997821:task-definition\/scope-prod-uade-identity-once:[0-9]+$/.test(c.taskDefinition)) fail('INVALID_TASK_DEFINITION');
  if (!/^309490997821\.dkr\.ecr\.us-east-1\.amazonaws\.com\/scope\/api@sha256:[0-9a-f]{64}$/.test(c.image)) fail('INVALID_IMAGE');
  if (!/^arn:aws:iam::309490997821:role\/scope-prod-uade-identity-once-task$/.test(c.taskRole)) fail('INVALID_TASK_ROLE');
  if (c.executionRole !== 'arn:aws:iam::309490997821:role/scope-prod-provisioner-execution') fail('INVALID_EXECUTION_ROLE');
  if (!c.subnetIds.length || !c.subnetIds.every(x => /^subnet-[0-9a-f]+$/.test(x))) fail('INVALID_SUBNET');
  if (!c.securityGroupIds.length || !c.securityGroupIds.every(x => /^sg-[0-9a-f]+$/.test(x))) fail('INVALID_SECURITY_GROUP');
}
function request(c) {
  fixedConfiguration(c);
  return { cluster: c.cluster, taskDefinition: c.taskDefinition, count: 1, launchType: 'FARGATE',
    networkConfiguration: { awsvpcConfiguration: { subnets: [...c.subnetIds], securityGroups: [...c.securityGroupIds], assignPublicIp: 'ENABLED' } },
    enableExecuteCommand: false };
}
function checkDefinition(c, td) {
  if (td.taskDefinitionArn !== c.taskDefinition || td.taskRoleArn !== c.taskRole || td.executionRoleArn !== c.executionRole ||
      td.status !== 'ACTIVE' || td.containerDefinitions.length !== 1) fail('TASK_DEFINITION_MISMATCH');
  const a = td.containerDefinitions[0];
  if (a.name !== c.containerName || a.image !== c.image || JSON.stringify(a.entryPoint) !== JSON.stringify(entryPoint) ||
      (a.command && a.command.length !== 0)) fail('CONTAINER_DEFINITION_MISMATCH');
  const env = (a.environment || []).map(x => [x.name, x.value]).sort();
  if (JSON.stringify(env) !== JSON.stringify([['AWS_REGION', 'us-east-1'], ['PUBLIC_DID_BASE_URL', 'https://api.scopeedu.technology']])) fail('ENVIRONMENT_MISMATCH');
  const secrets = a.secrets || [];
  if (secrets.length !== 1 || secrets[0].name !== 'DATABASE_URL' ||
      secrets[0].valueFrom !== 'arn:aws:ssm:us-east-1:309490997821:parameter/scope/prod/api/DATABASE_URL') fail('SECRETS_MISMATCH');
}
function checkTask(c, task) {
  if (task.clusterArn !== c.cluster || task.taskDefinitionArn !== c.taskDefinition || task.enableExecuteCommand !== false) fail('TASK_MISMATCH');
  const o = task.overrides || {};
  if (Object.keys(o).some(k => k !== 'containerOverrides') ||
      (o.containerOverrides || []).some(x => Object.keys(x).some(k => k !== 'name'))) fail('UNEXPECTED_OVERRIDES');
}
function aws(c, args, input) {
  const run = spawnSync('aws', [...args, '--profile', c.profile, '--region', c.region, '--output', 'json', '--no-cli-pager'],
    { encoding: 'utf8', input, shell: false, windowsHide: true });
  if (run.status !== 0) fail('AWS_CALL_FAILED_OR_AMBIGUOUS_NO_RETRY');
  try { return JSON.parse(run.stdout); } catch { fail('INVALID_AWS_RESPONSE_NO_RETRY'); }
}
function main() {
  if (process.argv.length !== 2) fail('ARGUMENTS_NOT_ALLOWED');
  const req = request(config);
  const td = aws(config, ['ecs', 'describe-task-definition', '--task-definition', config.taskDefinition]).taskDefinition;
  checkDefinition(config, td);
  const result = aws(config, ['ecs', 'run-task', '--cli-input-json', JSON.stringify(req)]);
  if (result.failures?.length || result.tasks?.length !== 1) fail('RUNTASK_FAILED_OR_AMBIGUOUS_NO_RETRY');
  const arn = result.tasks[0].taskArn;
  try {
    const described = aws(config, ['ecs', 'describe-tasks', '--cluster', config.cluster, '--tasks', arn]);
    if (described.failures?.length || described.tasks?.length !== 1) fail('TASK_NOT_VERIFIABLE');
    checkTask(config, described.tasks[0]);
  } catch { fail('TASK_STARTED_BUT_VERIFICATION_FAILED_NO_RETRY: ' + arn); }
  process.stdout.write('TASK_VERIFIED=' + arn + '\n');
}
if (require.main === module) {
  try { main(); } catch (e) { process.stderr.write(String(e.message) + '\n'); process.exitCode = 1; }
}
module.exports = { request, checkDefinition, checkTask };
