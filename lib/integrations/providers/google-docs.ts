import { createGoogleDriveProvider, GOOGLE_DOC_MIME_TYPE } from './google-drive-base';

export const googleDocsProvider = createGoogleDriveProvider({
  id: 'google_docs',
  label: 'Google Docs',
  summaryLabel: 'Google Docs document activity',
  includeMimeTypes: [GOOGLE_DOC_MIME_TYPE]
});
