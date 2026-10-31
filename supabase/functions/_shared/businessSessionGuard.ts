type Caller = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };

// Invoke with the verified caller's Authorization header, never a service key.
// This reaches the authoritative Auth/session/member/device checks even when
// the protected handler subsequently uses a service client or external API.
export async function businessSessionAllowed(caller: Caller): Promise<boolean> {
  try { const {data,error}=await caller.rpc('business_session_allowed',{});return !error&&data===true; }
  catch { return false; }
}
export function guardBusinessRequest(
  handler: (request: Request) => Response | Promise<Response>,
  client: (request: Request) => Caller,
  shouldCheck: (request: Request) => boolean = request => request.method !== 'OPTIONS',
) {
  return async (request: Request): Promise<Response> => {
    if (shouldCheck(request) && !await businessSessionAllowed(client(request))) {
      return new Response(JSON.stringify({error:'Sign in again to continue.',code:'ACTIVE_SESSION_REQUIRED'}),{
        status:401,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store, max-age=0',
          'CDN-Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type,range',
          'Access-Control-Allow-Methods':'POST,GET,HEAD,OPTIONS'},
      });
    }
    return handler(request);
  };
}
