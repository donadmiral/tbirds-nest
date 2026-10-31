"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { WORKFLOW_OPERATIONS, workflowFailure, WorkflowFailure, type WorkflowOperation } from "@/lib/studioWorkflows";
import styles from "./StudioWorkspace.module.css";

type Pending = { owner: string; operation: WorkflowOperation; key: string; args: Record<string,unknown> };
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function restore(key:string,owner:string):Pending|null {
  if(typeof window==="undefined")return null;
  try{const value=window.sessionStorage.getItem(key);if(!value||value.length>40000)return null;const pending=JSON.parse(value) as Pending;if(pending.owner===owner&&uuid.test(pending.key)&&WORKFLOW_OPERATIONS.includes(pending.operation)&&pending.args&&typeof pending.args==="object"&&!Array.isArray(pending.args))return pending;}catch{}
  return null;
}
/** Retain one exact request across ambiguous responses, even after tab reload.
 * Session storage is scoped to both the business account and bound member. */
export function useStudioMutation<T>({owner,member,kind,onConfirmed}:{owner:string;member:string|null;kind:string;onConfirmed:(row:T)=>void}) {
  const storageKey=`pc-studio-command-v1:${owner}:${member||"creator"}:${kind}`;
  const [pending,setPending]=useState<Pending|null>(()=>restore(storageKey,owner));
  const request=useRef<Pending|null>(pending),lock=useRef(false),active=useRef(true);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const persist=(value:Pending|null)=>{if(value)window.sessionStorage.setItem(storageKey,JSON.stringify(value));else window.sessionStorage.removeItem(storageKey);request.current=value;setPending(value);};
  const execute=async(command:Pending)=>{
    if(lock.current)return;lock.current=true;setBusy(true);setError(null);
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      const client=createClient();
      const current=await client.auth.getSession();
      if(!active.current)return;
      if(current.error||current.data.session?.user.id!==owner)throw new WorkflowFailure("Your account changed. Reopen this workspace.",true);
      const work=client.rpc(command.operation,{...command.args,p_expected_user:owner,p_request_key:command.key});
      const result=await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new WorkflowFailure("This change was not confirmed. Retry the same request to check its outcome safely.",false)),20000);})]);
      if(!active.current)return;
      if(result.error)throw workflowFailure(result.error);
      const row=result.data as T&{id?:string;version?:number};
      if(!row||!row.id||!Number.isInteger(row.version))throw new WorkflowFailure("The result could not be confirmed. Retry the same request safely.",false);
      persist(null);onConfirmed(row);
    }catch(reason){if(!active.current)return;const failure=workflowFailure(reason);setError(failure.message);if(failure.confirmedRejected){try{persist(null);}catch{request.current=null;setPending(null);}}}
    finally{if(timer)clearTimeout(timer);lock.current=false;if(active.current)setBusy(false);}
  };
  const run=async(operation:WorkflowOperation,args:Record<string,unknown>)=>{
    if(lock.current)return;
    if(request.current){setError("An earlier change is still unconfirmed. Retry that saved request before starting another action.");return;}
    const command:Pending={owner,operation,key:crypto.randomUUID(),args};
    try{persist(command);}catch{setError("This tab could not save retry information. Allow session storage before making this change.");return;}
    await execute(command);
  };
  return {run,busy,error,clearError:()=>setError(null),pending:!!pending,retry:async()=>{if(request.current)await execute(request.current);}};
}
export function WorkflowRecovery({error,pending,busy,retry}:{error:string|null;pending:boolean;busy:boolean;retry:()=>Promise<void>}) {
  if(!error&&!pending)return null;
  return <div className={`${styles.notice} ${error?styles.error:""}`} role={error?"alert":"status"}><p>{error||"A saved change has not been confirmed. Retry the same request to check its outcome."}</p>{pending&&!busy?<button className={`${styles.button} mt-3`} onClick={()=>void retry()}>Retry saved request</button>:null}{busy?<p className="mt-2">Confirming this change…</p>:null}</div>;
}
