import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(__dirname, '../../../..');
const terraformDirectory = join(repositoryRoot, 'infra', 'terraform', 'prod');
const probeTerraform = readFileSync(join(terraformDirectory, 'ecs_sync_probe.tf'), 'utf8');
const probeVariables = readFileSync(
  join(terraformDirectory, 'ecs_sync_probe_variables.tf'),
  'utf8',
);
const probeProductionConfiguration = readFileSync(
  join(terraformDirectory, 'ecs_sync_probe.auto.tfvars'),
  'utf8',
);
const probeProductionAssignments = probeProductionConfiguration
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n');
const dockerfile = readFileSync(
  join(repositoryRoot, 'infra', 'docker', 'ecs-sync-probe', 'Dockerfile'),
  'utf8',
);
const entrypoint = readFileSync(
  join(repositoryRoot, 'infra', 'docker', 'ecs-sync-probe', 'entrypoint.sh'),
  'utf8',
);
test('isolated ECS sync probe is opt-in and digest pinned', () => {
  assert.match(
    probeVariables,
    /variable "enable_ecs_sync_probe"[\s\S]*?default\s+=\s+false/,
  );
  assert.match(
    probeVariables,
    /variable "enable_ecs_sync_probe_github_oidc_caller"[\s\S]*?default\s+=\s+false/,
  );
  assert.match(
    probeVariables,
    /variable "ecs_sync_probe_image_digest"[\s\S]*?sha256:\[0-9a-f\]\{64\}/,
  );
  assert.match(
    probeTerraform,
    /resource "aws_ecs_task_definition" "ecs_sync_probe"[\s\S]*?count\s+=\s+local\.ecs_sync_probe_enabled/,
  );
  assert.match(
    probeTerraform,
    /image\s+=\s+"\$\{aws_ecr_repository\.ecs_sync_probe\[0\]\.repository_url\}@\$\{var\.ecs_sync_probe_image_digest\}"/,
  );
  assert.match(probeTerraform, /readonlyRootFilesystem\s+=\s+true/);
  assert.match(probeTerraform, /user\s+=\s+"65532:65532"/);
  assert.match(probeTerraform, /secrets\s+=\s+\[\]/);
  assert.match(probeTerraform, /mountPoints\s+=\s+\[\]/);
  assert.match(probeTerraform, /volumesFrom\s+=\s+\[\]/);
});

test('probe task has no persistent-write application role', () => {
  assert.match(
    probeTerraform,
    /resource "aws_iam_role" "ecs_sync_probe_task"[\s\S]*?Policy-free application role/,
  );
  assert.doesNotMatch(
    probeTerraform,
    /resource "aws_iam_role_policy" "ecs_sync_probe_task"/,
  );
  assert.doesNotMatch(probeTerraform, /aws_db_instance|aws_ssm_parameter/);
  assert.doesNotMatch(probeTerraform, /aws_sfn_state_machine" "provisioner/);
  assert.doesNotMatch(probeTerraform, /issuer-provisioner/);
});

test('production desired state preserves the reviewed probe without its caller', () => {
  assert.match(probeProductionConfiguration, /enable_ecs_sync_probe\s+=\s+true/);
  assert.match(
    probeProductionConfiguration,
    /enable_ecs_sync_probe_github_oidc_caller\s+=\s+false/,
  );
  assert.match(
    probeProductionConfiguration,
    /ecs_sync_probe_image_digest\s+=\s+"sha256:aabb9b3380d56ec8053082e8c41a6bd72a595c4559bb5032f7c7da3ee0c7c02b"/,
  );
  assert.doesNotMatch(probeProductionAssignments, /(secret|password|token|private_key|access_key)/i);
});

test('probe state machine has fixed infrastructure, bounded modes, and no retries', () => {
  assert.match(probeTerraform, /resource "aws_sfn_state_machine" "ecs_sync_probe"/);
  assert.match(probeTerraform, /"Resource": "arn:aws:states:::ecs:runTask\.sync"/);
  assert.match(probeTerraform, /"StringEquals": "exit-zero"/);
  assert.match(probeTerraform, /"StringEquals": "exit-nonzero"/);
  assert.match(probeTerraform, /"Command\.\$": "States\.Array\(\$\.mode\)"/);
  assert.match(probeTerraform, /"EnableExecuteCommand": false/);
  assert.match(probeTerraform, /"AssignPublicIp": "ENABLED"/);
  assert.doesNotMatch(probeTerraform, /"Retry"\s*:/);
  assert.doesNotMatch(probeTerraform, /TaskDefinition\.\$/);
  assert.doesNotMatch(probeTerraform, /Cluster\.\$/);
  assert.doesNotMatch(probeTerraform, /SecurityGroups\.\$/);
  assert.doesNotMatch(probeTerraform, /Subnets\.\$/);
});

test('probe image is pinned and provides only deterministic exits', () => {
  assert.match(
    dockerfile,
    /busybox@sha256:b7f3d86d6e84fc17718c48bcde1450807faa2d56704205c697b4bd5df7b9e29f/,
  );
  assert.match(dockerfile, /USER 65532:65532/);
  assert.match(entrypoint, /exit-zero/);
  assert.match(entrypoint, /exit-nonzero/);
  assert.match(entrypoint, /exit 0/);
  assert.match(entrypoint, /exit 23/);
  assert.doesNotMatch(entrypoint, /\b(curl|wget|nc|aws|psql|node)\b/);
});

test('dedicated GitHub caller can start only the isolated probe', () => {
  assert.match(
    probeTerraform,
    /ecs_sync_probe_operator_enabled\s+=\s+local\.ecs_sync_probe_enabled\s+&&\s+var\.enable_ecs_sync_probe_github_oidc_caller/,
  );
  assert.match(
    probeTerraform,
    /resource "aws_iam_role" "ecs_sync_probe_operator"[\s\S]*?count\s+=\s+local\.ecs_sync_probe_operator_enabled/,
  );
  assert.match(probeTerraform, /"states:StartExecution"/);
  assert.match(
    probeTerraform,
    /resources\s+=\s+\[aws_sfn_state_machine\.ecs_sync_probe\[0\]\.arn\]/,
  );
  assert.doesNotMatch(
    probeTerraform,
    /resource "aws_iam_role_policy" "ecs_sync_probe_operator"[\s\S]*?(ecs:RunTask|iam:PassRole)/,
  );
  assert.match(probeTerraform, /token\.actions\.githubusercontent\.com:aud/);
  assert.match(probeTerraform, /token\.actions\.githubusercontent\.com:sub/);
  assert.match(probeTerraform, /token\.actions\.githubusercontent\.com:ref/);
  assert.match(probeTerraform, /token\.actions\.githubusercontent\.com:environment/);
  assert.match(probeTerraform, /token\.actions\.githubusercontent\.com:event_name/);
  assert.match(probeTerraform, /token\.actions\.githubusercontent\.com:workflow/);
  assert.match(probeTerraform, /token\.actions\.githubusercontent\.com:repository_id/);
  assert.match(probeTerraform, /token\.actions\.githubusercontent\.com:repository_owner_id/);
});
