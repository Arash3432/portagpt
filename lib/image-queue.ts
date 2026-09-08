import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { db } from "./db";
import { getEnv } from "./env";
import { parseJsonResponse } from "./http";
import { resolveModel } from "./models";
import { getProviderConfig, providerEndpoint } from "./provider";
import { completeImageGeneration, releaseImageCredits, releaseTextReservation, settleTextCost } from "./quotas";
import { saveGeneratedImage } from "./storage";

type ImageJobData = { requestId:string;userId:string;modelAlias:string;prompt:string };

declare global {
  var __portalImageQueue: Queue<ImageJobData> | undefined;
  var __portalImageWorker: Worker<ImageJobData> | undefined;
  var __portalBullConnection: IORedis | undefined;
}

function connection(){
  if(!globalThis.__portalBullConnection)globalThis.__portalBullConnection=new IORedis(getEnv().REDIS_URL,{maxRetriesPerRequest:null,enableReadyCheck:true});
  return globalThis.__portalBullConnection;
}

export function imageQueue(){
  if(!globalThis.__portalImageQueue)globalThis.__portalImageQueue=new Queue<ImageJobData>("portal-image-v1",{connection:connection(),defaultJobOptions:{attempts:1,removeOnComplete:true,removeOnFail:true}});
  return globalThis.__portalImageQueue;
}

export function ensureImageWorker(){
  if(globalThis.__portalImageWorker)return globalThis.__portalImageWorker;
  globalThis.__portalImageWorker=new Worker<ImageJobData>("portal-image-v1",async(job)=>{
    const {requestId}=job.data;
    let providerCharged=false;let providerId:string|null=null;let costMicroUsd=0;
    try{
      const records=await db()<Array<{user_id:string;model_alias:string;prompt:string;cost_micro_usd:number|string}>>`update image_jobs set status='processing' where request_id=${requestId} and status='queued' returning user_id,model_alias,prompt,cost_micro_usd`;
      // A duplicate delivery must not release the original worker's reservation.
      const record=records[0];if(!record)return;
      const userId=record.user_id,modelAlias=record.model_alias,prompt=record.prompt;
      const model=await resolveModel(modelAlias,"image");costMicroUsd=Number(record.cost_micro_usd);
      const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),110_000);
      let upstream:Response;
      try {
      const provider=await getProviderConfig(model);const endpoint=await providerEndpoint("images",model);const options:Record<string,unknown>={model:model.providerModel,prompt,n:1,size:model.imageSize||"1024x1024",response_format:"b64_json"};if(model.imageQuality)options.quality=model.imageQuality;providerCharged=true;upstream=await fetch(endpoint,{method:"POST",signal:controller.signal,redirect:"error",headers:{"content-type":"application/json",authorization:`Bearer ${provider.apiKey}`,"idempotency-key":requestId},body:JSON.stringify(options)});
      if(!upstream.ok){providerCharged=upstream.status>=500;await upstream.body?.cancel();throw new Error(`UPSTREAM_${upstream.status}`);}
      const payload=await parseJsonResponse(upstream,30*1024*1024) as {id?:string;data?:Array<{url?:string;b64_json?:string;revised_prompt?:string}>};const result=payload.data?.[0];if(!result)throw new Error("EMPTY_IMAGE_RESPONSE");
      const file=await saveGeneratedImage(userId,requestId,{url:result.url,b64:result.b64_json});providerId=payload.id||upstream.headers.get("x-request-id");
      await completeImageGeneration({requestId,providerRequestId:providerId,actualMicroUsd:costMicroUsd,fileId:file.id,revisedPrompt:result.revised_prompt});
      return {fileId:file.id};
      } finally { clearTimeout(timeout); }
    }catch(error){const code=error instanceof Error?error.message:"IMAGE_WORKER_FAILED";const account=providerCharged?settleTextCost({requestId,inputTokens:0,outputTokens:0,actualMicroUsd:costMicroUsd,providerRequestId:providerId}):releaseTextReservation(requestId,code);await Promise.all([account.catch(()=>undefined),releaseImageCredits(requestId,code).catch(()=>undefined),db()`update image_jobs set status='failed',error_code=${code.slice(0,80)},completed_at=now() where request_id=${requestId} and status in ('queued','processing')`.catch(()=>undefined)]);throw error;}
  },{connection:connection(),concurrency:4,maxStalledCount:0,limiter:{max:12,duration:1000}});
  globalThis.__portalImageWorker.on("error",()=>undefined);
  return globalThis.__portalImageWorker;
}

export async function enqueueImage(data:ImageJobData){ensureImageWorker();await imageQueue().add("generate",data,{jobId:data.requestId});}
