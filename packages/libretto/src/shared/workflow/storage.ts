import type { MinimalLogger } from "../logger/logger.js";

export type GcpTemporaryStorageAccess = {
  provider: "gcp";
  bucket: string;
  prefix: string;
  accessToken: string;
  expiresAt?: string;
};

export type WorkflowStorageAccess = GcpTemporaryStorageAccess;

export type WorkflowStorageUploadResult = {
  provider: "gcp";
  bucket: string;
  objectName: string;
  uri: string;
};

export type WorkflowStorageContext = {
  upload(args: {
    storageAccess: WorkflowStorageAccess;
    fileName: string;
    body: string | Buffer;
    contentType: string;
  }): Promise<WorkflowStorageUploadResult>;
  uploadJson(args: {
    storageAccess: WorkflowStorageAccess;
    fileName: string;
    payload: unknown;
  }): Promise<WorkflowStorageUploadResult>;
};

function normalizeObjectPrefix(prefix: string): string {
  if (!prefix) {
    return "";
  }

  return prefix.replace(/^\/+/, "").replace(/\/+$/, "");
}

function joinObjectName(prefix: string, fileName: string): string {
  const normalizedPrefix = normalizeObjectPrefix(prefix);
  return normalizedPrefix ? `${normalizedPrefix}/${fileName}` : fileName;
}

async function uploadToTemporaryGcs(args: {
  storageAccess: GcpTemporaryStorageAccess;
  fileName: string;
  body: string | Buffer;
  contentType: string;
  logger: MinimalLogger;
}): Promise<WorkflowStorageUploadResult> {
  const { storageAccess, fileName, body, contentType, logger } = args;
  const objectName = joinObjectName(storageAccess.prefix, fileName);
  const url = new URL(
    `https://storage.googleapis.com/upload/storage/v1/b/${storageAccess.bucket}/o`,
  );
  url.searchParams.set("uploadType", "media");
  url.searchParams.set("name", objectName);
  url.searchParams.set("ifGenerationMatch", "0");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${storageAccess.accessToken}`,
      "Content-Type": contentType,
    },
    body: typeof body === "string" ? body : new Uint8Array(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.warn("workflow-storage-upload-failed", {
      bucket: storageAccess.bucket,
      objectName,
      status: response.status,
      errorText,
    });
    throw new Error(
      `Failed to upload ${objectName} to ${storageAccess.bucket}: ${response.status} ${errorText}`,
    );
  }

  logger.info("workflow-storage-uploaded", {
    bucket: storageAccess.bucket,
    objectName,
  });

  return {
    provider: "gcp",
    bucket: storageAccess.bucket,
    objectName,
    uri: `gs://${storageAccess.bucket}/${objectName}`,
  };
}

export function createWorkflowStorageContext(
  logger: MinimalLogger,
): WorkflowStorageContext {
  const upload: WorkflowStorageContext["upload"] = async ({
    storageAccess,
    fileName,
    body,
    contentType,
  }) => {
    if (storageAccess.provider !== "gcp") {
      throw new Error(
        `Unsupported workflow storage provider: ${storageAccess.provider}`,
      );
    }

    return await uploadToTemporaryGcs({
      storageAccess,
      fileName,
      body,
      contentType,
      logger,
    });
  };

  return {
    upload,
    async uploadJson({ storageAccess, fileName, payload }) {
      return await upload({
        storageAccess,
        fileName,
        body: JSON.stringify(payload),
        contentType: "application/json",
      });
    },
  };
}
