import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
                                       
	            
	                
	                    
 

                                      
	                       
	           
		             
		   
		                                                                     
		                                                                       
		                                                           
		   
		                                        
	  
	               
		       
		 
			              
			                  
			                      
			                        
			                                                      
			                       
			                          
			                                                                       
		 
	  
 

                                       
	                       
	                         
	                             
	                                                    
	                          
	                                                                           
	                                 
	                                                                           
	                                 
	                                                   
 

function nonEmpty(value         )                     {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

export function pifrostConfigDir(env                    = process.env)         {
	return nonEmpty(env.PIFROST_CONFIG_DIR) ?? resolve(homedir(), ".config/pifrost");
}

                                      
	          
	               
 

function readJsonResult   (path        )                      {
	if (!existsSync(path)) return {};
	try {
		const parsed          = JSON.parse(readFileSync(path, "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return { error: `Expected JSON object: ${path}` };
		}
		return { value: parsed      };
	} catch (error) {
		return {
			error: `${path}: ${error instanceof Error ? error.message : "invalid JSON"}`,
		};
	}
}

export function loadStoredConfigResult(env                    = process.env)                                        {
	return readJsonResult                     (resolve(pifrostConfigDir(env), "config.json"));
}

export function loadStoredSecretsResult(env                    = process.env)                                         {
	return readJsonResult                      (resolve(pifrostConfigDir(env), "secrets.json"));
}

export function loadStoredConfig(env                    = process.env)                                  {
	return loadStoredConfigResult(env).value;
}

export function loadStoredSecrets(env                    = process.env)                                   {
	return loadStoredSecretsResult(env).value;
}

/**
 * Load the runtime inference connection written by the standalone `pifrost` CLI.
 * This is intentionally inference-only. Neither OSS admin credentials nor an
 * Enterprise management API key are exposed to the OMP extension runtime.
 */
export function storedRuntimeConfigDiagnostics(env                    = process.env)           {
	const config = loadStoredConfigResult(env);
	const secrets = loadStoredSecretsResult(env);
	return [config.error, secrets.error].filter((value)                  => Boolean(value));
}

export function loadStoredRuntimeConfig(env                    = process.env)                                {
	const config = loadStoredConfig(env);
	const secrets = loadStoredSecrets(env);
	return {
		url: nonEmpty(config?.bifrost?.url),
		apiKey: nonEmpty(secrets?.inferenceApiKey),
		virtualKey: nonEmpty(secrets?.inferenceVirtualKey),
	};
}


//# sourceURL=/home/runner/work/pifrost/pifrost/config-store.ts