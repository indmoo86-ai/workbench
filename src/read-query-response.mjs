export const READ_REPLY_BYTES=524288;
const size=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
const metadataKeys=['relativePath','path','entry','hash','size','executable','modifiedAt','readSource','sourceNodeId','readNodeId','workspaceId','generation','scopeId','scopeGeneration','observedAt','freshness','matched','proof'];

/** Budget the final wire object, including escaping and envelope, before it reaches a capped socket. */
export function budgetReadReply({id,result,error},{maxBytes=READ_REPLY_BYTES}={}){
  let message={type:'reply',id,...(error!==undefined?{error}:{result})},serializedBytes=size(message),metadataOnly=false;
  if(serializedBytes>maxBytes){
    if(result&&((typeof result.hash==='string'&&Number.isSafeInteger(result.size))||result.entry?.hash)){
      const metadata=Object.fromEntries(metadataKeys.filter(k=>result[k]!==undefined).map(k=>[k,result[k]]));
      message={type:'reply',id,result:{...metadata,preview:'too_large',content:null,reason:'serialized_response_limit'}};metadataOnly=true;
    }else message={type:'reply',id,error:'response_too_large'};
    serializedBytes=size(message);
    if(serializedBytes>maxBytes){message={type:'reply',id:typeof id==='string'&&id.length<=200?id:null,error:'response_too_large'};serializedBytes=size(message);metadataOnly=false;}
  }
  return {message,serializedBytes,metadataOnly};
}
