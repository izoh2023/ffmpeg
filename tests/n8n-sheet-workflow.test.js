const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const workflowPath = path.join(__dirname, '..', 'n8n-drive-logo-swap.workflow.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const byName = new Map(workflow.nodes.map((node) => [node.name, node]));

assert.equal(workflow.name, 'Google Sheets - Batch FFmpeg Logo Swap');
assert.equal(byName.has('Find Videos in Input Folder'), false);

const read = byName.get('Read Content Sheet with Link Metadata');
assert.ok(read, 'workflow must read the content spreadsheet');
assert.equal(read.type, 'n8n-nodes-base.httpRequest');
assert.equal(read.parameters.nodeCredentialType, 'googleSheetsOAuth2Api');
assert.match(read.parameters.url, /spreadsheets/);
assert.match(JSON.stringify(read.parameters.queryParameters), /A:F/);

const ensureFailureHeader = byName.get('Ensure Failure Reason Header');
assert.ok(ensureFailureHeader, 'workflow must create the Failure Reason header');
assert.match(ensureFailureHeader.parameters.url, /values/);
assert.match(JSON.stringify(ensureFailureHeader.parameters), /Failure Reason/);

const prepare = byName.get('Prepare Eligible Sheet Rows');
assert.ok(prepare, 'workflow must convert sheet cells into row work items');
assert.equal(prepare.type, 'n8n-nodes-base.code');
assert.match(prepare.parameters.jsCode, /chipRuns/);
assert.match(prepare.parameters.jsCode, /row_number/);
assert.match(prepare.parameters.jsCode, /Content Link/);
assert.match(prepare.parameters.jsCode, /Rebranded Content Links/);
assert.match(
  prepare.parameters.jsCode,
  /return results;/,
  'every eligible sheet row must enter the sequential clip loop',
);
assert.doesNotMatch(
  prepare.parameters.jsCode,
  /results\.slice\(/,
  'the sheet parser must not cap the total number of clips in an execution',
);

const clipLoop = byName.get('Process One Clip at a Time');
assert.ok(clipLoop, 'workflow must retain explicit one-clip-at-a-time processing');
assert.equal(clipLoop.type, 'n8n-nodes-base.splitInBatches');
assert.equal(clipLoop.parameters.batchSize, 1);

const sampleSheetResponse = {
  sheets: [{
    data: [{
      startRow: 0,
      rowData: [
        { values: ['Name', 'Content Link', 'Status', 'Website Link', 'Rebranded Content Links'].map((formattedValue) => ({ formattedValue })) },
        { values: [
          { formattedValue: 'Earl Foote' },
          { formattedValue: 'Clip One.mp4', chipRuns: [{ chip: { richLinkProperties: { uri: 'https://drive.google.com/file/d/12345678901234567890/view' } } }] },
          { formattedValue: 'Processing' },
          { formattedValue: 'Website', hyperlink: 'https://example.com/clip-one' },
          { formattedValue: '' },
        ] },
        { values: [
          { formattedValue: 'Already complete' },
          { formattedValue: 'Clip Two.mp4', hyperlink: 'https://drive.google.com/open?id=abcdefghijklmnopqrstuv' },
          { formattedValue: 'Created' },
          { formattedValue: '' },
          { formattedValue: 'Result.mp4', chipRuns: [{ chip: { richLinkProperties: { uri: 'https://drive.google.com/file/d/result123456789012345/view' } } }] },
        ] },
        { values: [
          { formattedValue: 'Raw URL clip' },
          { formattedValue: 'https://drive.google.com/file/d/rawurl123456789012345/view?usp=sharing' },
          { formattedValue: '' },
          { formattedValue: '' },
          { formattedValue: '' },
          { formattedValue: '' },
        ] },
      ],
    }],
  }],
};
const parserScript = new vm.Script(`(function () { ${prepare.parameters.jsCode} })()`);
const parsedRows = parserScript.runInNewContext({
  $input: { first: () => ({ json: sampleSheetResponse }) },
  decodeURIComponent,
});
assert.equal(parsedRows.length, 2);
assert.deepEqual(JSON.parse(JSON.stringify(parsedRows[0].json)), {
  Name: 'Earl Foote',
  'Content Link': 'https://drive.google.com/file/d/12345678901234567890/view',
  Status: 'Processing',
  'Website Link': 'https://example.com/clip-one',
  'Rebranded Content Links': '',
  'Failure Reason': '',
  row_number: 2,
  driveFileId: '12345678901234567890',
  filename: 'Clip One.mp4',
});
assert.equal(parsedRows[1].json.driveFileId, 'rawurl123456789012345');
assert.equal(parsedRows[1].json.filename, 'rawurl123456789012345.mp4');
assert.doesNotMatch(parsedRows[1].json.filename, /^https?:\/\//);

const config = byName.get('Configuration - Edit These Values');
const names = config.parameters.assignments.assignments.map((item) => item.name);
assert.ok(names.includes('sheetDocumentId'));
assert.ok(names.includes('sheetName'));
assert.equal(names.includes('inputFolderId'), false);
assert.doesNotMatch(prepare.parameters.jsCode, /\['created', 'processing'\]/);

const context = byName.get('Prepare Clip Context');
const contextFields = Object.fromEntries(
  context.parameters.assignments.assignments.map((item) => [item.name, item.value]),
);
assert.match(contextFields.driveFileId, /driveFileId/);
assert.match(contextFields.row_number, /row_number/);

const download = byName.get('Download Clip from Drive');
assert.equal(download.type, 'n8n-nodes-base.httpRequest');
assert.equal(download.parameters.authentication, 'predefinedCredentialType');
assert.equal(download.parameters.nodeCredentialType, 'googleDriveOAuth2Api');
assert.match(download.parameters.url, /googleapis\.com\/drive\/v3\/files/);
assert.match(JSON.stringify(download.parameters.queryParameters), /alt.*media/);
assert.equal(download.parameters.options.response.response.responseFormat, 'file');
assert.equal(download.parameters.options.response.response.outputPropertyName, 'video');
assert.notEqual(download.alwaysOutputData, true);
assert.equal(download.retryOnFail, true);
assert.equal(download.maxTries, 5);
assert.ok(download.waitBetweenTries >= 15000);
assert.equal(download.onError, 'continueErrorOutput');
assert.equal(download.parameters.options.fileName, undefined);

for (const updateName of ['Mark Source Row Processing', 'Update Rebranded Content Link']) {
  const update = byName.get(updateName);
  assert.ok(update, `${updateName} must exist`);
  assert.equal(update.type, 'n8n-nodes-base.googleSheets');
  assert.equal(update.parameters.operation, 'update');
  assert.ok(update.parameters.columns.value.row_number);
}

const completed = byName.get('Build Completed Sheet Row');
const completedFields = Object.fromEntries(
  completed.parameters.assignments.assignments.map((item) => [item.name, item.value]),
);
assert.equal(completedFields.Status, 'Created');
assert.match(completedFields['Rebranded Content Links'], /drive\.google\.com/);
assert.match(completedFields.row_number, /row_number/);
assert.equal(completedFields['Failure Reason'], '');

const failed = byName.get('Build Failed Sheet Row');
const failedFields = Object.fromEntries(
  failed.parameters.assignments.assignments.map((item) => [item.name, item.value]),
);
assert.match(failedFields['Failure Reason'], /error/);

const finalUpdateValues = byName.get('Update Rebranded Content Link').parameters.columns.value;
assert.ok(finalUpdateValues['Failure Reason']);

const cleanup = byName.get('Clean Up FFmpeg Job');
assert.match(cleanup.parameters.url, /preserveErrors=true/);

const serializedConnections = JSON.stringify(workflow.connections);
assert.match(serializedConnections, /Read Content Sheet with Link Metadata/);
assert.match(serializedConnections, /Prepare Eligible Sheet Rows/);
assert.match(serializedConnections, /Update Rebranded Content Link/);
assert.match(serializedConnections, /Ensure Failure Reason Header/);
assert.equal(workflow.connections['Download Clip from Drive'].main[1][0].node, 'Build Download Failed Sheet Row');
const clipDownloadSuccessTargets = workflow.connections['Download Clip from Drive'].main[0]
  .map((connection) => connection.node);
assert.ok(
  clipDownloadSuccessTargets.includes('Upload Clip to Local FFmpeg'),
  'the downloaded video binary must go directly to the local upload node',
);
assert.ok(
  clipDownloadSuccessTargets.includes('Download Replacement Logo'),
  'the replacement logo must download on a parallel branch',
);
assert.equal(
  workflow.connections['Download Replacement Logo'].main[0][0].node,
  'Restore Logo Binary',
  'the logo binary must go to merge input 1',
);
assert.equal(workflow.connections['Download Replacement Logo'].main[0][0].index, 0);
assert.equal(
  workflow.connections['Upload Clip to Local FFmpeg'].main[0][0].node,
  'Restore Logo Binary',
  'the video upload response must go to merge input 2',
);
assert.equal(workflow.connections['Upload Clip to Local FFmpeg'].main[0][0].index, 1);

const nodeNames = new Set(workflow.nodes.map((node) => node.name));
assert.equal(nodeNames.size, workflow.nodes.length, 'node names must be unique');
for (const [source, outputs] of Object.entries(workflow.connections)) {
  assert.ok(nodeNames.has(source), `connection source ${source} must exist`);
  for (const branch of outputs.main ?? []) {
    for (const target of branch ?? []) {
      assert.ok(nodeNames.has(target.node), `connection target ${target.node} must exist`);
    }
  }
}

console.log('n8n sheet-driven workflow contract is valid');
