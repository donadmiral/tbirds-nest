import {integrationRuntime} from '../live-integrations-core/runtime.ts';
import {createSocialOptionsHandler} from '../live-integrations-core/social.ts';
Deno.serve(createSocialOptionsHandler(integrationRuntime()));
