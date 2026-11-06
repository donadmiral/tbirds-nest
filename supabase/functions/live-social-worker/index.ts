import {integrationRuntime} from '../live-integrations-core/runtime.ts';
import {createSocialWorkerHandler} from '../live-integrations-core/social.ts';
Deno.serve(createSocialWorkerHandler({...integrationRuntime(),secret:Deno.env.get('LIVE_SOCIAL_WORKER_SECRET')||''}));
