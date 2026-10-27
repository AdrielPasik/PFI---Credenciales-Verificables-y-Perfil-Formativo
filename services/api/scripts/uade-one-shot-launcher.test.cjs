'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { request, checkDefinition, checkTask } = require('./uade-one-shot-launcher.cjs');
const c = {
  profile: 'scope-signin', region: 'us-east-1',
  cluster: 'arn:aws:ecs:us-east-1:309490997821:cluster/scope-prod-cluster',
  taskDefinition: 'arn:aws:ecs:us-east-1:309490997821:task-definition/scope-prod-uade-identity-once:1',
  image: '309490997821.dkr.ecr.us-east-1.amazonaws.com/scope/api@sha256:' + 'a'.repeat(64),
  taskRole: 'arn:aws:iam::309490997821:role/scope-prod-uade-identity-once-task',
  executionRole: 'arn:aws:iam::309490997821:role/scope-prod-provisioner-execution',
  subnetIds: ['subnet-123'], securityGroupIds: ['sg-123'], containerName: 'provisioner'
};
const td = () => ({ taskDefinitionArn: c.taskDefinition, taskRoleArn: c.taskRole, executionRoleArn: c.executionRole, status: 'ACTIVE', containerDefinitions: [{
  name: 'provisioner', image: c.image, entryPoint: ['/bin/sh', '/app/services/api/docker/provision-uade-entrypoint.sh'], command: [],
  environment: [{ name: 'AWS_REGION', value: 'us-east-1' }, { name: 'PUBLIC_DID_BASE_URL', value: 'https://api.scopeedu.technology' }],
  secrets: [{ name: 'DATABASE_URL', valueFrom: 'arn:aws:ssm:us-east-1:309490997821:parameter/scope/prod/api/DATABASE_URL' }]
}] });
test('request is fixed and has no overrides', () => {
  const r = request(c);
  assert.equal(r.taskDefinition, c.taskDefinition);
  assert.equal(r.cluster, c.cluster);
  assert.equal(r.overrides, undefined);
  assert.equal(r.enableExecuteCommand, false);
  assert.throws(() => request({ ...c, image: 'REVIEW_REQUIRED' }));
});
test('reject mismatched definition, command, environment and secret', () => {
  assert.doesNotThrow(() => checkDefinition(c, td()));
  for (const change of [
    x => { x.taskRoleArn = 'wrong'; },
    x => { x.containerDefinitions[0].command = ['other']; },
    x => { x.containerDefinitions[0].environment.push({ name: 'AWS_ENDPOINT_URL', value: 'wrong' }); },
    x => { x.containerDefinitions[0].secrets[0].valueFrom = 'wrong'; }
  ]) { const x = td(); change(x); assert.throws(() => checkDefinition(c, x)); }
});
test('reject observed command and task-role overrides', () => {
  const x = { clusterArn: c.cluster, taskDefinitionArn: c.taskDefinition, enableExecuteCommand: false, overrides: { containerOverrides: [] } };
  assert.doesNotThrow(() => checkTask(c, x));
  assert.throws(() => checkTask(c, { ...x, overrides: { taskRoleArn: 'wrong' } }));
  assert.throws(() => checkTask(c, { ...x, overrides: { containerOverrides: [{ name: 'provisioner', command: ['other'] }] } }));
});
