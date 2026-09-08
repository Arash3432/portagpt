import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { db } from "./db";
import { getEnv } from "./env";
import { readResponseBytes } from "./http";

let client: S3Client | null = null;

function validatedStorageEndpoint(raw: string) {
  try {
    const endpoint = new URL(raw);
    const localDevelopment = endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1";
    if (endpoint.username || endpoint.password || (endpoint.protocol !== "https:" && !(localDevelopment && endpoint.protocol === "http:"))) {
      throw new Error("STORAGE_ENDPOINT_INVALID");
    }
    return endpoint.toString().replace(/\/$/, "");
  } catch {
    throw new Error("STORAGE_ENDPOINT_INVALID");
  }
}

function storage() {
  const env = getEnv();
  if (!env.S3_ENDPOINT || !env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) throw new Error("STORAGE_NOT_CONFIGURED");
  if (!client) client = new S3Client({ endpoint: validatedStorageEndpoint(env.S3_ENDPOINT), region: env.S3_REGION, forcePathStyle: true, credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } });
  return { client, bucket: env.S3_BUCKET };
}

export function detectImage(bytes: Uint8Array) {
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return { ext: "png", mime: "image/png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return { ext: "webp", mime: "image/webp" };
  throw new Error("UNSUPPORTED_IMAGE_FORMAT");
}

export function validateGeneratedImageUrl(value: string, allowlist: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("INVALID_IMAGE_SOURCE"); }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443") || isIP(hostname)
    || hostname === "localhost" || /\.(?:localhost|local|internal|home|lan)$/.test(hostname)) throw new Error("INVALID_IMAGE_SOURCE");
  const allowed = allowlist.split(",").map((host) => host.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean);
  if (!allowed.includes(hostname)) throw new Error("IMAGE_URL_NOT_ALLOWLISTED");
  return url.toString();
}

async function imageBytes(source: { url?: string; b64?: string }) {
  if (source.b64) {
    if (typeof source.b64 !== "string" || source.b64.length > 28 * 1024 * 1024) throw new Error("IMAGE_TOO_LARGE");
    const encoded = source.b64.replace(/\s/g, "");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 === 1) throw new Error("INVALID_IMAGE_SOURCE");
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length > 20 * 1024 * 1024) throw new Error("IMAGE_TOO_LARGE");
    return bytes;
  }
  if (!source.url || typeof source.url !== "string") throw new Error("INVALID_IMAGE_SOURCE");
  const imageUrl = validateGeneratedImageUrl(source.url, getEnv().AI_IMAGE_HOST_ALLOWLIST || "");
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(imageUrl, { signal: controller.signal, redirect: "error" });
    if (!response.ok) { await response.body?.cancel(); throw new Error("IMAGE_DOWNLOAD_FAILED"); }
    return await readResponseBytes(response, 20 * 1024 * 1024, "IMAGE_TOO_LARGE");
  } finally { clearTimeout(timeout); }
}

export async function saveGeneratedImage(userId: string, requestId: string, source: { url?: string; b64?: string }) {
  const bytes = await imageBytes(source); const kind = detectImage(bytes); const fileId = randomUUID();
  const key = `generated/${userId}/${new Date().toISOString().slice(0, 10)}/${fileId}.${kind.ext}`;
  const { client: s3, bucket } = storage();
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: kind.mime, CacheControl: "private, max-age=3600", Metadata: { userId, requestId } }));
  await db()`insert into files (id,user_id,storage_key,original_name,mime_type,size_bytes,status,kind) values (${fileId},${userId},${key},${`portal-${requestId}.${kind.ext}`},${kind.mime},${bytes.length},'ready','generated')`;
  return { id: fileId, url: `/api/assets/${fileId}` };
}

export async function getOwnedFile(userId: string, fileId: string) {
  const rows = await db()< { storage_key: string; mime_type: string; size_bytes: number; original_name: string }[]>`select storage_key,mime_type,size_bytes,original_name from files where id=${fileId} and user_id=${userId} and status='ready' and deleted_at is null`;
  const file = rows[0]; if (!file) return null;
  const { client: s3, bucket } = storage();
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: file.storage_key }));
  return { ...file, body: object.Body };
}

const allowedMime = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "text/plain", "text/markdown",
  "application/json", "text/csv", "application/zip", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/javascript", "text/typescript",
]);

function safeFilename(name: string) {
  const clean = name.replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/\.{2,}/g, ".").slice(0, 150);
  return clean || "upload.bin";
}

async function cleanupStaleUploads(userId:string){
  const rows=await db()<Array<{id:string;storage_key:string}>>`select id,storage_key from files where user_id=${userId} and status='pending' and created_at<now()-interval '1 hour' limit 1000`;
  if(!rows.length)return;
  const {client:s3,bucket}=storage();
  await s3.send(new DeleteObjectsCommand({Bucket:bucket,Delete:{Quiet:true,Objects:rows.map((row)=>({Key:row.storage_key}))}}));
  await db()`update files set status='deleted',deleted_at=now(),updated_at=now() where user_id=${userId} and id in ${db()(rows.map((row)=>row.id))} and status='pending'`;
}

const uploadCaps:Record<string,{dailyFiles:number;dailyBytes:number;totalBytes:number}>={
  free:{dailyFiles:3,dailyBytes:50*1024*1024,totalBytes:250*1024*1024},starter:{dailyFiles:50,dailyBytes:250*1024*1024,totalBytes:2*1024*1024*1024},plus:{dailyFiles:100,dailyBytes:500*1024*1024,totalBytes:5*1024*1024*1024},pro:{dailyFiles:250,dailyBytes:1024*1024*1024,totalBytes:15*1024*1024*1024},ultra:{dailyFiles:500,dailyBytes:2*1024*1024*1024,totalBytes:30*1024*1024*1024},
};

export async function createUploadPlans(userId: string, inputs: Array<{ name: string; type: string; size: number }>, plan: string) {
  const { client: s3, bucket } = storage();
  for (const input of inputs) if (!allowedMime.has(input.type)) throw new Error("UNSUPPORTED_FILE_TYPE");
  await cleanupStaleUploads(userId);
  const sql = db();
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`upload:${userId}`}))`;
    const cap=uploadCaps[plan]||uploadCaps.free;const requestedBytes=inputs.reduce((sum,input)=>sum+input.size,0);
    const [usage] = await tx<Array<{ daily_count: string; daily_bytes:string; total_bytes:string }>>`
        select count(*) filter(where created_at>=date_trunc('day',now() at time zone 'Asia/Tehran') at time zone 'Asia/Tehran')::text as daily_count,
        coalesce(sum(size_bytes) filter(where created_at>=date_trunc('day',now() at time zone 'Asia/Tehran') at time zone 'Asia/Tehran'),0)::text as daily_bytes,
        coalesce(sum(size_bytes),0)::text as total_bytes from files where user_id=${userId} and kind='upload' and status!='deleted'
      `;
    if(Number(usage?.daily_count||0)+inputs.length>cap.dailyFiles)throw new Error("DAILY_FILE_LIMIT");
    if(Number(usage?.daily_bytes||0)+requestedBytes>cap.dailyBytes)throw new Error("DAILY_STORAGE_LIMIT");
    if(Number(usage?.total_bytes||0)+requestedBytes>cap.totalBytes)throw new Error("TOTAL_STORAGE_LIMIT");
    const result: Array<{ id: string; uploadUrl: string; headers: { "content-type": string }; expiresIn: number }> = [];
    for (const input of inputs) {
      const id = randomUUID(); const name = safeFilename(input.name); const key = `uploads/${userId}/${new Date().toISOString().slice(0,10)}/${id}-${name}`;
      const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: input.type, ContentLength: input.size });
      const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 600 });
      await tx`insert into files (id,user_id,storage_key,original_name,mime_type,size_bytes,status,kind) values (${id},${userId},${key},${name},${input.type},${input.size},'pending','upload')`;
      result.push({ id, uploadUrl, headers: { "content-type": input.type }, expiresIn: 600 });
    }
    return result;
  });
}

export function validMagic(bytes: Uint8Array, mime: string) {
  if (["image/png", "image/jpeg", "image/webp"].includes(mime)) {
    try { return detectImage(bytes).mime === mime; } catch { return false; }
  }
  if (mime === "image/gif") return ["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.slice(0, 6)));
  if (mime === "application/pdf") return String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  if (mime.includes("zip") || mime.includes("officedocument")) return bytes[0] === 0x50 && bytes[1] === 0x4b;
  return !bytes.slice(0, 4096).some((value) => value === 0);
}

export async function completeUploads(userId: string, ids: string[]) {
  const { client: s3, bucket } = storage(); const completed = [];
  for (const id of ids) {
    const rows = await db()< { storage_key: string; mime_type: string; size_bytes: number }[]>`select storage_key,mime_type,size_bytes from files where id=${id} and user_id=${userId} and status='pending'`;
    const row = rows[0]; if (!row) throw new Error("UPLOAD_NOT_FOUND");
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: row.storage_key }));
    if (Number(head.ContentLength || 0) !== Number(row.size_bytes) || Number(head.ContentLength || 0) > 50 * 1024 * 1024) throw new Error("UPLOAD_SIZE_MISMATCH");
    const sample = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: row.storage_key, Range: "bytes=0-4095" }));
    const bytes = new Uint8Array(await sample.Body!.transformToByteArray());
    if (!validMagic(bytes, row.mime_type)) { await db()`update files set status='quarantined' where id=${id}`; throw new Error("FILE_SIGNATURE_MISMATCH"); }
    await db()`update files set status='ready',updated_at=now() where id=${id}`; completed.push(id);
  }
  return completed;
}

export async function prepareAttachmentsForModel(userId: string, ids: string[], fileLimit: number) {
  if (!ids.length) return { textBlocks: [] as string[], imageUrls: [] as string[] };
  if (ids.length > fileLimit) throw new Error("FILE_COUNT_EXCEEDED");
  const rows = await db()<Array<{ id: string; storage_key: string; mime_type: string; size_bytes: number; original_name: string }>>`
    select id,storage_key,mime_type,size_bytes,original_name from files
    where user_id=${userId} and id in ${db()(ids)} and status='ready' and deleted_at is null
  `;
  if (rows.length !== ids.length) throw new Error("ATTACHMENT_NOT_FOUND");
  if (rows.reduce((sum, row) => sum + Number(row.size_bytes), 0) > 50 * 1024 * 1024) throw new Error("ATTACHMENT_TOTAL_TOO_LARGE");
  const { client: s3, bucket } = storage(); const textBlocks: string[] = []; const imageUrls: string[] = [];
  let extractedBytes = 0;
  for (const row of rows) {
    if (row.mime_type.startsWith("image/")) {
      imageUrls.push(await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: row.storage_key }), { expiresIn: 600 }));
      continue;
    }
    if (row.mime_type.startsWith("text/") || row.mime_type === "application/json") {
      extractedBytes += Number(row.size_bytes);
      if (Number(row.size_bytes) > 2 * 1024 * 1024 || extractedBytes > 4 * 1024 * 1024) throw new Error("ATTACHMENT_TOO_LARGE_FOR_MODEL");
      const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: row.storage_key }));
      const text = await object.Body!.transformToString("utf-8");
      textBlocks.push(`\n\n<portal_user_file name="${row.original_name.replace(/[<>\"]/g, "_")}">\n${text}\n</portal_user_file>`);
      continue;
    }
    throw new Error("FILE_TYPE_REQUIRES_PROVIDER_ADAPTER");
  }
  return { textBlocks, imageUrls };
}

export async function deleteAllUserObjects(userId: string) {
  const rows = await db()<Array<{ storage_key: string }>>`select storage_key from files where user_id=${userId} and deleted_at is null`;
  if (!rows.length) return;
  const { client: s3, bucket } = storage();
  for (let index = 0; index < rows.length; index += 1000) {
    await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Quiet: true, Objects: rows.slice(index,index+1000).map((row) => ({ Key: row.storage_key })) } }));
  }
}

export async function deleteConversationObjects(userId:string,conversationId:string){
  const rows=await db()<Array<{id:string;storage_key:string}>>`
    select distinct f.id,f.storage_key from files f join message_files mf on mf.file_id=f.id join messages m on m.id=mf.message_id
    where m.conversation_id=${conversationId} and f.user_id=${userId} and f.deleted_at is null and not exists(
      select 1 from message_files other_mf join messages other_m on other_m.id=other_mf.message_id join conversations other_c on other_c.id=other_m.conversation_id
      where other_mf.file_id=f.id and other_m.conversation_id<>${conversationId} and other_c.deleted_at is null
    )
  `;
  if(!rows.length)return [] as string[];
  const {client:s3,bucket}=storage();
  await s3.send(new DeleteObjectsCommand({Bucket:bucket,Delete:{Quiet:true,Objects:rows.map((row)=>({Key:row.storage_key}))}}));
  return rows.map((row)=>row.id);
}
