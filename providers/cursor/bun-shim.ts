/** Re-export shared Bun shim for Node+jiti hosts (import.meta.dir, Bun.hash.wyhash, bun YAML stub, PI agent dir). */
export {
	installBunShim,
	ensurePiAgentDir,
	installImportMetaDirPolyfill,
	installBunPackageShim,
} from "../../shared/bun-shim.ts";
import { installBunShim } from "../../shared/bun-shim.ts";
installBunShim();
