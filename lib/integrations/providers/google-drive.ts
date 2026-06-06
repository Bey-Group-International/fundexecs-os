import {
  createGoogleDriveProvider,
  GOOGLE_DOC_MIME_TYPE,
  GOOGLE_SLIDES_MIME_TYPE
} from './google-drive-base';

export const googleDriveProvider = createGoogleDriveProvider({
  id: 'google_drive',
  label: 'Google Drive',
  summaryLabel: 'Google Drive file activity',
  excludeMimeTypes: [GOOGLE_DOC_MIME_TYPE, GOOGLE_SLIDES_MIME_TYPE]
});
