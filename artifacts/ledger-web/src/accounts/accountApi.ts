import {
  deleteCredentialLink,
  getAccountSync,
  putAccountSync,
  putCredentialLink,
  type AccountSyncWrite,
} from "@workspace/api-client-react";

import {
  errorStatus,
  type AccountWriteApi,
  type SyncContainer,
  readSyncContainers,
} from "./accountModel";

export const accountSyncQueryKey = ["account-sync"] as const;

export async function loadAccountSync(): Promise<SyncContainer[]> {
  try {
    const record = await getAccountSync();
    return readSyncContainers(record.containers);
  } catch (error) {
    if (errorStatus(error) === 404) return [];
    throw error;
  }
}

export const accountWriteApi: AccountWriteApi = {
  putCredentialLink: (exchange, id, body) => putCredentialLink(exchange, id, body),
  deleteCredentialLink: (exchange, id) => deleteCredentialLink(exchange, id),
  putAccountSync: (body) => putAccountSync(body as AccountSyncWrite),
};
