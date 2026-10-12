import {resolve,relative,isAbsolute,basename,extname} from 'node:path';
import {entryEqual,syncError,validateSourcePath} from './source-sync-manifest.mjs';
import {sourceScopeBinding} from './source-sync-scopes.mjs';

/** Display reads only the bound Mac's actual files; Home transfer blobs are not display copies. */
export class ProjectFiles {
  constructor({db,query,online}){Object.assign(this,{db,query,online});}
  config(projectId){
    if(!this.db.get('projects',projectId))throw syncError('project_missing');
    const config=this.db.get('sourceSyncConfigs',projectId);
    if(config?.scopeKind!=='directory'||!config.displayNodeId)throw syncError('display_node_required');return config;
  }
  binding(projectId,scopeId){
    const config=this.config(projectId),nodeId=config.displayNodeId,binding=config.bindings.find(b=>b.repositoryId===scopeId&&b.nodeId===nodeId);
    if(!binding||sourceScopeBinding(this.db,projectId,scopeId,nodeId)?.localRoot!==binding.root)throw syncError('binding_changed');
    const worker=this.db.get('workers',nodeId);if(worker?.platform!=='darwin'||worker?.capabilities?.projectFiles!==1)throw syncError('worker_unsupported');
    return {...binding,projectId,generation:config.generation,revision:config.revision};
  }
  /** Map registered scopes only; a same-named isolated output is not a delivered project file. */
  reference(run,path){
    if(!this.db.get('projects',run.projectId))throw syncError('project_missing');
    const config=this.db.get('sourceSyncConfigs',run.projectId);if(config?.scopeKind!=='directory')return null;
    if(typeof path!=='string'||path.length>4096)return null;
    if(!isAbsolute(path)&&!run.workspace)return null;
    const absolute=isAbsolute(path)?resolve(path):resolve(run.workspace,path);
    for(const binding of config.bindings.filter(b=>b.nodeId===run.nodeId).sort((a,b)=>b.root.length-a.root.length)){
      if(sourceScopeBinding(this.db,run.projectId,binding.repositoryId,run.nodeId)?.localRoot!==binding.root)continue;
      const rel=relative(binding.root,absolute);if(!rel||isAbsolute(rel)||rel==='..'||rel.startsWith('../'))continue;
      try{validateSourcePath(rel,binding.scopePolicy);return {scopeId:binding.repositoryId,path:rel};}catch{}
    }
    return null;
  }
  state(projectId,binding,path,entry){
    if(this.db.listProject('sourceSyncConflicts',projectId).some(c=>c.repositoryId===binding.repositoryId&&c.path===path&&!['resolved','cancelled'].includes(c.status)))return 'conflict';
    const canonical=this.db.get('sourceSyncManifests',`${projectId}:${binding.repositoryId}`),expected=canonical?.entries?.[path]||null;
    if(!entry)return expected?'pending':'missing';return entryEqual(entry,expected)?'synchronized':'local_changes';
  }
  async queryBinding(binding,action,extra={}){
    if(!this.online(binding.nodeId))throw syncError('display_device_offline');
    const result=await this.query({nodeId:binding.nodeId},action,{...binding,...extra},30000);
    if(JSON.stringify(this.binding(binding.projectId,binding.repositoryId))!==JSON.stringify(binding))throw syncError('binding_changed');
    return result;
  }
  async read(projectId,scopeId,path,{metadata=false}={}){
    const binding=this.binding(projectId,scopeId);validateSourcePath(path,binding.scopePolicy);
    const result=await this.queryBinding(binding,'project_file',{path,metadata});
    if(result.relativePath!==path||result.path&&result.path!==resolve(binding.root,path))throw syncError('invalid_file_response');
    return {...result,projectId,scopeId,nodeId:binding.nodeId,syncState:this.state(projectId,binding,path,result.entry),shared:true};
  }
  async list(projectId){
    const config=this.config(projectId),items=[],errors=[];let partial=false;
    for(const scopeId of [...new Set(config.bindings.filter(b=>b.nodeId===config.displayNodeId).map(b=>b.repositoryId))]){
      try{const binding=this.binding(projectId,scopeId),result=await this.queryBinding(binding,'project_files',{limit:200});partial ||= result.partial;
        for(const file of result.items){validateSourcePath(file.relativePath,binding.scopePolicy);if(file.path!==resolve(binding.root,file.relativePath))throw syncError('invalid_file_response');
          items.push({...file,projectId,scopeId,nodeId:binding.nodeId,name:basename(file.relativePath),type:extname(file.relativePath).slice(1).toUpperCase()||'FILE',source:'Local project file',shared:true,syncState:this.state(projectId,binding,file.relativePath,file.entry)});
        }
        const known=new Set(result.items.map(f=>f.relativePath));
        if(!result.partial)for(const [path,entry] of Object.entries(this.db.get('sourceSyncManifests',`${projectId}:${scopeId}`)?.entries||{}))if(entry&&!known.has(path)&&items.length<600)items.push({projectId,scopeId,nodeId:binding.nodeId,relativePath:path,path:null,name:basename(path),type:extname(path).slice(1).toUpperCase()||'FILE',source:'Waiting for local synchronization',shared:true,syncState:'pending'});
      }catch(error){partial=true;errors.push({scopeId,error:error.code||error.message});}
    }
    items.sort((a,b)=>Number(b.relativePath.startsWith('.workbench/docs/'))-Number(a.relativePath.startsWith('.workbench/docs/'))||a.relativePath.localeCompare(b.relativePath));
    return {items:items.slice(0,600),partial:partial||items.length>600,errors,displayNodeId:config.displayNodeId};
  }
}
