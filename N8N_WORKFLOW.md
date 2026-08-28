# Google Sheets Batch FFmpeg Logo Swap

`n8n-drive-logo-swap.workflow.json` is an importable n8n workflow for rebranding a batch of Google Drive videos with the local FFmpeg logo-swap API.

## What it does

The workflow reads clip links from a Google Sheet, skips rows that already have a rebranded output, and processes eligible clips one at a time. For each row it:

1. Resolves the source video from the `Content Link` cell, including Google Drive smart chips.
2. Downloads the video and the configured replacement logo from Google Drive.
3. Sends both files to the local FFmpeg API and polls the job until it finishes.
4. Uploads the finished video to the configured Drive output folder.
5. Updates the exact source row with `Status`, `Rebranded Content Links`, and `Failure Reason`.

Processing one clip at a time protects the local FFmpeg service from parallel heavy jobs. Download and processing failures are written to the sheet, and the workflow then continues to the next row.

## Setup

1. Import `n8n-drive-logo-swap.workflow.json` into n8n.
2. Open **Configuration - Edit These Values** and set:
   - `sheetDocumentId`
   - `sheetName`
   - `outputFolderId`
   - `replacementLogoFileId`
   - `ffmpegBaseUrl`
3. Select valid Google Sheets and Google Drive OAuth credentials on the relevant nodes.
4. Make sure the sheet has `Name`, `Content Link`, `Status`, `Website Link`, `Rebranded Content Links`, and `Failure Reason` columns. The workflow also ensures the `Failure Reason` header exists in column F.
5. Start the local FFmpeg API and confirm n8n can reach `ffmpegBaseUrl`.
6. Run the manual trigger first. Enable the disabled hourly trigger only after the configuration and credentials are verified.

Rows with `Status` set to `Created` or a populated `Rebranded Content Links` cell are not processed again.

## Validation and maintenance

Run the workflow contract check with:

```bash
node tests/n8n-sheet-workflow.test.js
```

`scripts/rebuild-n8n-sheet-workflow.js` rebuilds the workflow definition, while `scripts/apply-workflow-resilience.js` applies the retry and failure-reporting safeguards. Re-run the contract test after regenerating the JSON.
