const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(__dirname, '..', 'n8n-drive-logo-swap.workflow.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

if (workflow.nodes.some((candidate) => candidate.name === 'Read Content Sheet with Link Metadata')) {
  const existingNode = (name) => workflow.nodes.find((candidate) => candidate.name === name);
  existingNode('Read Content Sheet with Link Metadata').credentials = { googleSheetsOAuth2Api: { id: 'vCA7hw9dD4eQLgXu', name: 'impact cred' } };
  existingNode('Mark Source Row Processing').credentials = { googleSheetsOAuth2Api: { id: 'vCA7hw9dD4eQLgXu', name: 'impact cred' } };
  existingNode('Update Rebranded Content Link').credentials = { googleSheetsOAuth2Api: { id: 'vCA7hw9dD4eQLgXu', name: 'impact cred' } };
  for (const driveNodeName of ['Download Clip from Drive', 'Download Replacement Logo', 'Upload Result to Drive']) {
    existingNode(driveNodeName).credentials = { googleDriveOAuth2Api: { id: 'u2Av9c6AgNCTOVZG', name: 'Google Drive account' } };
  }
  fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
  require('node:child_process').execFileSync(process.execPath, [path.join(__dirname, 'apply-workflow-resilience.js'), workflowPath]);
  process.exit(0);
}

const removeNames = new Set([
  'Look Up Processing Ledger',
  'Already Complete?',
  'Skipped - Already Complete',
]);
workflow.nodes = workflow.nodes.filter((node) => !removeNames.has(node.name));

const node = (name) => {
  const result = workflow.nodes.find((candidate) => candidate.name === name);
  if (!result) throw new Error(`Missing source node: ${name}`);
  return result;
};

workflow.name = 'Google Sheets - Batch FFmpeg Logo Swap';
workflow.updatedAt = '2026-08-12T00:00:00.000Z';

node('Configuration - Edit These Values').parameters.assignments.assignments = [
  { id: '20000000-0000-4000-8000-000000000001', name: 'sheetDocumentId', value: '1IoHQ_xxDS4acrdv1MI05cDHw-EJkKs2exKngNEcD2o4', type: 'string' },
  { id: '20000000-0000-4000-8000-000000000002', name: 'sheetName', value: 'January Content', type: 'string' },
  { id: '20000000-0000-4000-8000-000000000003', name: 'outputFolderId', value: 'REPLACE_WITH_OUTPUT_DRIVE_FOLDER_ID', type: 'string' },
  { id: '20000000-0000-4000-8000-000000000004', name: 'replacementLogoFileId', value: 'REPLACE_WITH_LOGO_DRIVE_FILE_ID', type: 'string' },
  { id: '20000000-0000-4000-8000-000000000005', name: 'ffmpegBaseUrl', value: 'http://host.docker.internal:9000', type: 'string' },
];

const read = node('Find Videos in Input Folder');
read.name = 'Read Content Sheet with Link Metadata';
read.type = 'n8n-nodes-base.httpRequest';
read.typeVersion = 4.3;
read.position = [-800, 160];
read.parameters = {
  authentication: 'predefinedCredentialType',
  nodeCredentialType: 'googleSheetsOAuth2Api',
  url: "={{ 'https://sheets.googleapis.com/v4/spreadsheets/' + $('Configuration - Edit These Values').first().json.sheetDocumentId }}",
  sendQuery: true,
  queryParameters: {
    parameters: [
      { name: 'includeGridData', value: 'true' },
      { name: 'ranges', value: "={{ \"'\" + $('Configuration - Edit These Values').first().json.sheetName.replace(/'/g, \"''\") + \"'!A:E\" }}" },
      { name: 'fields', value: 'sheets(properties(title),data(startRow,rowData(values(formattedValue,hyperlink,userEnteredValue,textFormatRuns,chipRuns))))' },
    ],
  },
  options: {
    timeout: 30000,
    response: { response: { fullResponse: false, neverError: false, responseFormat: 'json' } },
  },
};
read.notesInFlow = true;
read.notes = 'Reads columns A:E with Google Sheets cell metadata so Drive smart-chip URIs are available, not only their displayed filenames. Select the Google Sheets credential on this node.';
read.credentials = { googleSheetsOAuth2Api: { id: 'vCA7hw9dD4eQLgXu', name: 'impact cred' } };

workflow.nodes.push({
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: `const response = $input.first().json;

const uriFromCell = (cell = {}) => {
  const chipUri = (cell.chipRuns ?? [])
    .map((run) => run?.chip?.richLinkProperties?.uri)
    .find(Boolean);
  if (chipUri) return chipUri;
  if (cell.hyperlink) return cell.hyperlink;
  const richTextUri = (cell.textFormatRuns ?? [])
    .map((run) => run?.format?.link?.uri)
    .find(Boolean);
  if (richTextUri) return richTextUri;
  const formula = cell.userEnteredValue?.formulaValue ?? '';
  const formulaMatch = formula.match(/^=HYPERLINK\\(\\s*["']([^"']+)/i);
  if (formulaMatch) return formulaMatch[1];
  const display = String(cell.formattedValue ?? '').trim();
  return /^https?:\\/\\//i.test(display) ? display : '';
};

const driveFileIdFrom = (value = '') => {
  const decoded = decodeURIComponent(String(value));
  return decoded.match(/\\/d\\/([a-zA-Z0-9_-]+)/)?.[1]
    ?? decoded.match(/[?&]id=([a-zA-Z0-9_-]+)/)?.[1]
    ?? decoded.match(/\\/file\\/([a-zA-Z0-9_-]+)/)?.[1]
    ?? (/^[a-zA-Z0-9_-]{20,}$/.test(decoded) ? decoded : '');
};

const safeVideoFilename = (cell = {}, driveFileId = '') => {
  const display = String(cell.formattedValue ?? '').trim();
  if (display && !/^https?:\/\//i.test(display)) return display;
  return driveFileId + '.mp4';
};

const results = [];
for (const sheet of response.sheets ?? []) {
  for (const block of sheet.data ?? []) {
    const startRow = Number(block.startRow ?? 0);
    for (const [offset, row] of (block.rowData ?? []).entries()) {
      const rowNumber = startRow + offset + 1;
      if (rowNumber === 1) continue;
      const cells = row.values ?? [];
      const contentLink = uriFromCell(cells[1]);
      const rebrandedLink = uriFromCell(cells[4]);
      const status = String(cells[2]?.formattedValue ?? '').trim();
      const driveFileId = driveFileIdFrom(contentLink);
      if (!contentLink || !driveFileId || rebrandedLink || ['created', 'processing'].includes(status.toLowerCase())) continue;
      results.push({
        json: {
          Name: String(cells[0]?.formattedValue ?? '').trim(),
          'Content Link': contentLink,
          Status: status,
          'Website Link': uriFromCell(cells[3]) || String(cells[3]?.formattedValue ?? '').trim(),
          'Rebranded Content Links': rebrandedLink,
          row_number: rowNumber,
          driveFileId,
          filename: safeVideoFilename(cells[1], driveFileId),
        },
      });
    }
  }
}
return results;`,
  },
  id: '10000000-0000-4000-8000-000000000030',
  name: 'Prepare Eligible Sheet Rows',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [-680, 160],
  notesInFlow: true,
  notes: 'Keeps rows whose Content Link points to a Drive file and whose Rebranded Content Links cell is blank. Preserves the physical row number for exact updates.',
});

node('Process One Clip at a Time').position = [-440, 160];

const context = node('Prepare Clip Context');
context.position = [-200, 200];
context.parameters.assignments.assignments = [
  { id: '20000000-0000-4000-8000-000000000007', name: 'driveFileId', value: "={{ $('Process One Clip at a Time').item.json.driveFileId }}", type: 'string' },
  { id: '20000000-0000-4000-8000-000000000008', name: 'filename', value: "={{ $('Process One Clip at a Time').item.json.filename }}", type: 'string' },
  { id: '20000000-0000-4000-8000-000000000009', name: 'row_number', value: "={{ $('Process One Clip at a Time').item.json.row_number }}", type: 'number' },
  { id: '20000000-0000-4000-8000-000000000010', name: 'contentLink', value: "={{ $('Process One Clip at a Time').item.json['Content Link'] }}", type: 'string' },
  { id: '20000000-0000-4000-8000-000000000011', name: 'existingRebrandedLink', value: "={{ $('Process One Clip at a Time').item.json['Rebranded Content Links'] || '' }}", type: 'string' },
];

const processing = node('Build Processing Ledger Row');
processing.name = 'Build Processing Source Row';
processing.position = [40, 200];
processing.parameters.assignments.assignments = [
  { id: '20000000-0000-4000-8000-000000000013', name: 'row_number', value: '={{ $json.row_number }}', type: 'number' },
  { id: '20000000-0000-4000-8000-000000000014', name: 'Status', value: 'Processing', type: 'string' },
];

const sheetSchema = [
  { id: 'Name', displayName: 'Name', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true, removed: false },
  { id: 'Content Link', displayName: 'Content Link', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true, removed: false },
  { id: 'Status', displayName: 'Status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true, removed: false },
  { id: 'Website Link', displayName: 'Website Link', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true, removed: false },
  { id: 'Rebranded Content Links', displayName: 'Rebranded Content Links', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true, removed: false },
  { id: 'row_number', displayName: 'row_number', required: false, defaultMatch: true, display: true, type: 'number', canBeUsedToMatch: true, readOnly: true, removed: true },
];

const sheetUpdateParameters = (value) => ({
  operation: 'update',
  documentId: { __rl: true, value: "={{ $('Configuration - Edit These Values').first().json.sheetDocumentId }}", mode: 'id' },
  sheetName: { __rl: true, value: "={{ $('Configuration - Edit These Values').first().json.sheetName }}", mode: 'name' },
  columns: {
    mappingMode: 'defineBelow',
    value,
    matchingColumns: ['row_number'],
    schema: sheetSchema,
    attemptToConvertTypes: false,
    convertFieldsToString: false,
  },
  options: { cellFormat: 'USER_ENTERED' },
});

const mark = node('Mark Clip Processing');
mark.name = 'Mark Source Row Processing';
mark.position = [280, 200];
mark.parameters = sheetUpdateParameters({
  row_number: '={{ $json.row_number }}',
  Status: '={{ $json.Status }}',
});
mark.notesInFlow = true;
mark.notes = 'Updates only Status on the exact source row. Add Processing to the Status dropdown choices if the sheet uses strict data validation.';
mark.credentials = { googleSheetsOAuth2Api: { id: 'vCA7hw9dD4eQLgXu', name: 'impact cred' } };

const completed = node('Build Completed Ledger Row');
completed.name = 'Build Completed Sheet Row';
completed.parameters.assignments.assignments = [
  { id: '20000000-0000-4000-8000-000000000024', name: 'row_number', value: "={{ $('Prepare Clip Context').item.json.row_number }}", type: 'number' },
  { id: '20000000-0000-4000-8000-000000000025', name: 'Status', value: 'Created', type: 'string' },
  { id: '20000000-0000-4000-8000-000000000026', name: 'Rebranded Content Links', value: "={{ $json.webViewLink || ('https://drive.google.com/file/d/' + $json.id + '/view') }}", type: 'string' },
];

const failed = node('Build Failed Ledger Row');
failed.name = 'Build Failed Sheet Row';
failed.parameters.assignments.assignments = [
  { id: '20000000-0000-4000-8000-000000000027', name: 'row_number', value: "={{ $('Prepare Clip Context').item.json.row_number }}", type: 'number' },
  { id: '20000000-0000-4000-8000-000000000028', name: 'Status', value: 'Failed', type: 'string' },
  { id: '20000000-0000-4000-8000-000000000029', name: 'Rebranded Content Links', value: "={{ $('Prepare Clip Context').item.json.existingRebrandedLink || '' }}", type: 'string' },
];

const update = node('Update Final Ledger Status');
update.name = 'Update Rebranded Content Link';
update.parameters = sheetUpdateParameters({
  row_number: '={{ $json.row_number }}',
  Status: '={{ $json.Status }}',
  'Rebranded Content Links': "={{ $json['Rebranded Content Links'] }}",
});
update.notesInFlow = true;
update.notes = 'Writes the uploaded rebranded Drive URL into Rebranded Content Links and sets Status on the same row that supplied Content Link.';
update.credentials = { googleSheetsOAuth2Api: { id: 'vCA7hw9dD4eQLgXu', name: 'impact cred' } };

for (const driveNodeName of ['Download Clip from Drive', 'Download Replacement Logo', 'Upload Result to Drive']) {
  node(driveNodeName).credentials = { googleDriveOAuth2Api: { id: 'u2Av9c6AgNCTOVZG', name: 'Google Drive account' } };
}

const clipDownload = node('Download Clip from Drive');
clipDownload.type = 'n8n-nodes-base.httpRequest';
clipDownload.typeVersion = 4.3;
clipDownload.parameters = {
  authentication: 'predefinedCredentialType',
  nodeCredentialType: 'googleDriveOAuth2Api',
  url: "={{ 'https://www.googleapis.com/drive/v3/files/' + $('Prepare Clip Context').item.json.driveFileId }}",
  sendQuery: true,
  queryParameters: { parameters: [
    { name: 'alt', value: 'media' },
    { name: 'supportsAllDrives', value: 'true' },
  ] },
  options: { timeout: 600000, response: { response: {
    fullResponse: false,
    neverError: false,
    responseFormat: 'file',
    outputPropertyName: 'video',
  } } },
};
delete clipDownload.alwaysOutputData;

workflow.connections = {
  'Manual Trigger': { main: [[{ node: 'Configuration - Edit These Values', type: 'main', index: 0 }]] },
  'Hourly Schedule': { main: [[{ node: 'Configuration - Edit These Values', type: 'main', index: 0 }]] },
  'Configuration - Edit These Values': { main: [[{ node: 'Read Content Sheet with Link Metadata', type: 'main', index: 0 }]] },
  'Read Content Sheet with Link Metadata': { main: [[{ node: 'Prepare Eligible Sheet Rows', type: 'main', index: 0 }]] },
  'Prepare Eligible Sheet Rows': { main: [[{ node: 'Process One Clip at a Time', type: 'main', index: 0 }]] },
  'Process One Clip at a Time': { main: [[{ node: 'Batch Complete', type: 'main', index: 0 }], [{ node: 'Prepare Clip Context', type: 'main', index: 0 }]] },
  'Prepare Clip Context': { main: [[{ node: 'Build Processing Source Row', type: 'main', index: 0 }]] },
  'Build Processing Source Row': { main: [[{ node: 'Mark Source Row Processing', type: 'main', index: 0 }]] },
  'Mark Source Row Processing': { main: [[{ node: 'Download Clip from Drive', type: 'main', index: 0 }]] },
  'Download Clip from Drive': { main: [[{ node: 'Upload Clip to Local FFmpeg', type: 'main', index: 0 }, { node: 'Download Replacement Logo', type: 'main', index: 0 }]] },
  'Download Replacement Logo': { main: [[{ node: 'Restore Logo Binary', type: 'main', index: 0 }]] },
  'Upload Clip to Local FFmpeg': { main: [[{ node: 'Restore Logo Binary', type: 'main', index: 1 }]] },
  'Restore Logo Binary': { main: [[{ node: 'Submit Logo Swap Job', type: 'main', index: 0 }]] },
  'Submit Logo Swap Job': { main: [[{ node: 'Wait Before Status Check', type: 'main', index: 0 }]] },
  'Wait Before Status Check': { main: [[{ node: 'Check Logo Swap Status', type: 'main', index: 0 }]] },
  'Check Logo Swap Status': { main: [[{ node: 'Swap Complete?', type: 'main', index: 0 }]] },
  'Swap Complete?': { main: [[{ node: 'Download Processed Video', type: 'main', index: 0 }], [{ node: 'Swap Failed?', type: 'main', index: 0 }]] },
  'Swap Failed?': { main: [[{ node: 'Build Failed Sheet Row', type: 'main', index: 0 }], [{ node: 'Polling Timed Out?', type: 'main', index: 0 }]] },
  'Polling Timed Out?': { main: [[{ node: 'Build Failed Sheet Row', type: 'main', index: 0 }], [{ node: 'Wait Before Status Check', type: 'main', index: 0 }]] },
  'Download Processed Video': { main: [[{ node: 'Upload Result to Drive', type: 'main', index: 0 }]] },
  'Upload Result to Drive': { main: [[{ node: 'Build Completed Sheet Row', type: 'main', index: 0 }]] },
  'Build Completed Sheet Row': { main: [[{ node: 'Update Rebranded Content Link', type: 'main', index: 0 }]] },
  'Build Failed Sheet Row': { main: [[{ node: 'Update Rebranded Content Link', type: 'main', index: 0 }]] },
  'Update Rebranded Content Link': { main: [[{ node: 'Clean Up FFmpeg Job', type: 'main', index: 0 }]] },
  'Clean Up FFmpeg Job': { main: [[{ node: 'Clean Up Uploaded Source', type: 'main', index: 0 }]] },
  'Clean Up Uploaded Source': { main: [[{ node: 'Process One Clip at a Time', type: 'main', index: 0 }]] },
};

fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
require('node:child_process').execFileSync(process.execPath, [path.join(__dirname, 'apply-workflow-resilience.js'), workflowPath]);
