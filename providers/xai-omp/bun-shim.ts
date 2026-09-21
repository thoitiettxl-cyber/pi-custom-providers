/** Re-export shared Bun shim for Node+jiti hosts. */
export {
	installBunShim,
	ensurePiAgentDir,
	installImportMetaDirPolyfill,
	installBunPackageShim,
} from "../../shared/bun-shim.ts";
import { installBunShim } from "../../shared/bun-shim.ts";
installBunShim();
