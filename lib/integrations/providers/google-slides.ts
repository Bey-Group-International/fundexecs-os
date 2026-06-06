import { createGoogleDriveProvider, GOOGLE_SLIDES_MIME_TYPE } from './google-drive-base';

export const googleSlidesProvider = createGoogleDriveProvider({
  id: 'google_slides',
  label: 'Google Slides',
  summaryLabel: 'Google Slides deck activity',
  includeMimeTypes: [GOOGLE_SLIDES_MIME_TYPE]
});
