const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'n8n-drive-logo-swap.workflow.json'));
const raw = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const workflow = Array.isArray(raw) ? raw[0] : raw;
const node = (name) => {
  const found = workflow.nodes.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing workflow node: ${name}`);
  return found;
};
const upsertAssignment = (target, assignment) => {
  const list = target.parameters.assignments.assignments;
  const index = list.findIndex((item) => item.name === assignment.name);
  if (index >= 0) list[index] = assignment;
  else list.push(assignment);
};

const config = node('Configuration - Edit These Values');
const read = node('Read Content Sheet with Link Metadata');
const prepare = node('Prepare Eligible Sheet Rows');
const download = node('Download Clip from Drive');
const completed = node('Build Completed Sheet Row');
const failed = node('Build Failed Sheet Row');
const update = node('Update Rebranded Content Link');
const cleanup = node('Clean Up FFmpeg Job');

const range = read.parameters.queryParameters.parameters.find((parameter) => parameter.name === 'ranges');
range.value = range.value.replace('!A:E', '!A:F');
if (!prepare.parameters.jsCode.includes('const safeVideoFilename')) {
  prepare.parameters.jsCode = prepare.parameters.jsCode.replace(
    'const results = [];',
    `const safeVideoFilename = (cell = {}, driveFileId = '') => {
  const display = String(cell.formattedValue ?? '').trim();
  if (display && !/^https?:\\/\\//i.test(display)) return display;
  return driveFileId + '.mp4';
};

const results = [];`,
  );
}
prepare.parameters.jsCode = prepare.parameters.jsCode
  .replace(/(?:\n\s*'Failure Reason': String\(cells\[5\]\?\.formattedValue \?\? ''\)\.trim\(\),)+/g, '')
  .replace(
    "'Rebranded Content Links': rebrandedLink,",
    "'Rebranded Content Links': rebrandedLink,\n          'Failure Reason': String(cells[5]?.formattedValue ?? '').trim(),",
  )
  .replace(
    "filename: String(cells[1]?.formattedValue ?? '').trim() || driveFileId + '.mp4',",
    'filename: safeVideoFilename(cells[1], driveFileId),',
  )
  .replace(/return results(?:\.slice\(0, \d+\))?;/, 'return results;');
prepare.parameters.jsCode = prepare.parameters.jsCode.replace(
  "['created', 'processing'].includes(status.toLowerCase())",
  "status.toLowerCase() === 'created'",
);

download.retryOnFail = true;
download.maxTries = 5;
download.waitBetweenTries = 15000;
download.onError = 'continueErrorOutput';
download.type = 'n8n-nodes-base.httpRequest';
download.typeVersion = 4.3;
download.parameters = {
  authentication: 'predefinedCredentialType',
  nodeCredentialType: 'googleDriveOAuth2Api',
  url: "={{ 'https://www.googleapis.com/drive/v3/files/' + $('Prepare Clip Context').item.json.driveFileId }}",
  sendQuery: true,
  queryParameters: {
    parameters: [
      { name: 'alt', value: 'media' },
      { name: 'supportsAllDrives', value: 'true' },
    ],
  },
  options: {
    timeout: 600000,
    response: {
      response: {
        fullResponse: false,
        neverError: false,
        responseFormat: 'file',
        outputPropertyName: 'video',
      },
    },
  },
};
delete download.alwaysOutputData;

upsertAssignment(completed, {
  id: '20000000-0000-4000-8000-000000000030',
  name: 'Failure Reason',
  value: '',
  type: 'string',
});
upsertAssignment(failed, {
  id: '20000000-0000-4000-8000-000000000031',
  name: 'Failure Reason',
  value: "={{ String($json.error?.message || $json.error || $json.message || ($json.status === 'processing' ? 'FFmpeg processing timed out' : 'Unknown FFmpeg error')).slice(0, 500) }}",
  type: 'string',
});

const failureSchema = {
  id: 'Failure Reason', displayName: 'Failure Reason', required: false,
  defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true, removed: false,
};
for (const sheetNode of [node('Mark Source Row Processing'), update]) {
  const schema = sheetNode.parameters.columns.schema;
  if (!schema.some((field) => field.id === 'Failure Reason')) schema.splice(-1, 0, failureSchema);
}
update.parameters.columns.value['Failure Reason'] = "={{ $json['Failure Reason'] || '' }}";
if (!cleanup.parameters.url.includes('preserveErrors=true')) {
  cleanup.parameters.url += cleanup.parameters.url.includes('?') ? '&preserveErrors=true' : '?preserveErrors=true';
}

if (!workflow.nodes.some((candidate) => candidate.name === 'Ensure Failure Reason Header')) {
  workflow.nodes.push({
    parameters: {
      method: 'PUT',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googleSheetsOAuth2Api',
      url: "={{ 'https://sheets.googleapis.com/v4/spreadsheets/' + $('Configuration - Edit These Values').first().json.sheetDocumentId + '/values/' + encodeURIComponent(\"'\" + $('Configuration - Edit These Values').first().json.sheetName + \"'!F1\") }}",
      sendQuery: true,
      queryParameters: { parameters: [{ name: 'valueInputOption', value: 'RAW' }] },
      sendBody: true,
      contentType: 'raw',
      rawContentType: 'application/json',
      body: '={"values":[["Failure Reason"]]}',
      options: { timeout: 30000, response: { response: { neverError: false, responseFormat: 'json' } } },
    },
    id: '10000000-0000-4000-8000-000000000031',
    name: 'Ensure Failure Reason Header',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.3,
    position: [-920, 160],
    credentials: read.credentials,
    notesInFlow: true,
    notes: 'Ensures column F is available for per-clip diagnostics.',
  });
}

if (!workflow.nodes.some((candidate) => candidate.name === 'Build Download Failed Sheet Row')) {
  workflow.nodes.push({
    parameters: {
      assignments: { assignments: [
        { id: '20000000-0000-4000-8000-000000000032', name: 'row_number', value: "={{ $('Prepare Clip Context').item.json.row_number }}", type: 'number' },
        { id: '20000000-0000-4000-8000-000000000033', name: 'Status', value: 'Failed', type: 'string' },
        { id: '20000000-0000-4000-8000-000000000034', name: 'Rebranded Content Links', value: "={{ $('Prepare Clip Context').item.json.existingRebrandedLink || '' }}", type: 'string' },
        { id: '20000000-0000-4000-8000-000000000035', name: 'Failure Reason', value: "={{ ('Drive download: ' + String($json.error?.message || $json.error || $json.message || 'connection failed')).slice(0, 500) }}", type: 'string' },
      ] },
      options: { stripBinary: true },
    },
    id: '10000000-0000-4000-8000-000000000032',
    name: 'Build Download Failed Sheet Row',
    type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [1120, 520],
  });
  const downloadUpdate = JSON.parse(JSON.stringify(update));
  downloadUpdate.id = '10000000-0000-4000-8000-000000000033';
  downloadUpdate.name = 'Update Download Failure';
  downloadUpdate.position = [1360, 520];
  downloadUpdate.notes = 'Writes a Drive download failure reason, then continues with the next clip.';
  workflow.nodes.push(downloadUpdate);
}

workflow.connections['Configuration - Edit These Values'] = { main: [[{ node: 'Ensure Failure Reason Header', type: 'main', index: 0 }]] };
workflow.connections['Ensure Failure Reason Header'] = { main: [[{ node: 'Read Content Sheet with Link Metadata', type: 'main', index: 0 }]] };
workflow.connections['Download Clip from Drive'] = { main: [
  [
    { node: 'Upload Clip to Local FFmpeg', type: 'main', index: 0 },
    { node: 'Download Replacement Logo', type: 'main', index: 0 },
  ],
  [{ node: 'Build Download Failed Sheet Row', type: 'main', index: 0 }],
] };
workflow.connections['Download Replacement Logo'] = { main: [[
  { node: 'Restore Logo Binary', type: 'main', index: 0 },
]] };
workflow.connections['Upload Clip to Local FFmpeg'] = { main: [[
  { node: 'Restore Logo Binary', type: 'main', index: 1 },
]] };
workflow.connections['Build Download Failed Sheet Row'] = { main: [[{ node: 'Update Download Failure', type: 'main', index: 0 }]] };
workflow.connections['Update Download Failure'] = { main: [[{ node: 'Process One Clip at a Time', type: 'main', index: 0 }]] };

fs.writeFileSync(workflowPath, `${JSON.stringify(Array.isArray(raw) ? [workflow] : workflow, null, 2)}\n`);
