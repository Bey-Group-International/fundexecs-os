import type { FetchContext, NormalizedContact, NormalizedInteraction, Provider } from '../types';

interface DrivePerson {
  emailAddress?: string;
  displayName?: string;
}

interface DriveFile {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
  owners?: DrivePerson[];
  lastModifyingUser?: DrivePerson;
}

interface DriveProviderOptions {
  id: string;
  label: string;
  summaryLabel: string;
  includeMimeTypes?: string[];
  excludeMimeTypes?: string[];
}

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DOC_MIME_TYPE = 'application/vnd.google-apps.document';
const SLIDES_MIME_TYPE = 'application/vnd.google-apps.presentation';

function quoted(value: string) {
  return `'${value.replace(/'/g, "\\'")}'`;
}

function buildQuery(options: DriveProviderOptions, since?: string) {
  const parts = ['trashed = false'];

  if (since) {
    parts.push(`modifiedTime > ${quoted(new Date(since).toISOString())}`);
  }

  if (options.includeMimeTypes?.length) {
    const mimeQuery = options.includeMimeTypes
      .map((mime) => `mimeType = ${quoted(mime)}`)
      .join(' or ');
    parts.push(`(${mimeQuery})`);
  }

  for (const mime of options.excludeMimeTypes ?? []) {
    parts.push(`mimeType != ${quoted(mime)}`);
  }

  return parts.join(' and ');
}

function pickExternalPerson(file: DriveFile, self: string | undefined): DrivePerson | null {
  const candidates = [file.lastModifyingUser, ...(file.owners ?? [])];
  for (const person of candidates) {
    const email = person?.emailAddress?.toLowerCase();
    if (email && email !== self) return person ?? null;
  }
  return null;
}

export function createGoogleDriveProvider(options: DriveProviderOptions): Provider {
  return {
    id: options.id,
    label: options.label,

    async fetchSignals({ token, since, userEmail }: FetchContext) {
      const params = new URLSearchParams({
        pageSize: '50',
        orderBy: 'modifiedTime desc',
        includeItemsFromAllDrives: 'true',
        supportsAllDrives: 'true',
        q: buildQuery(options, since),
        fields:
          'files(id,name,mimeType,modifiedTime,webViewLink,owners(emailAddress,displayName),lastModifyingUser(emailAddress,displayName))'
      });
      const res = await fetch(`${DRIVE_FILES}?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        throw new Error(`${options.label} API error ${res.status}: ${await res.text()}`);
      }

      const body = (await res.json()) as { files?: DriveFile[] };
      const contacts: NormalizedContact[] = [];
      const interactions: NormalizedInteraction[] = [];
      const self = userEmail?.toLowerCase();

      for (const file of body.files ?? []) {
        if (!file.id) continue;
        const occurredAt = file.modifiedTime
          ? new Date(file.modifiedTime).toISOString()
          : new Date().toISOString();
        const externalPerson = pickExternalPerson(file, self);
        const contactEmail = externalPerson?.emailAddress?.toLowerCase();

        if (contactEmail) {
          contacts.push({
            email: contactEmail,
            fullName: externalPerson?.displayName
          });
        }

        interactions.push({
          contactEmail,
          type: 'note',
          direction: 'internal',
          occurredAt,
          subject: file.name ?? options.summaryLabel,
          summary: [options.summaryLabel, file.mimeType, file.webViewLink]
            .filter(Boolean)
            .join(' | '),
          externalRef: `${file.id}:${file.modifiedTime ?? occurredAt}`
        });
      }

      return { contacts, interactions };
    }
  };
}

export const GOOGLE_DOC_MIME_TYPE = DOC_MIME_TYPE;
export const GOOGLE_SLIDES_MIME_TYPE = SLIDES_MIME_TYPE;
