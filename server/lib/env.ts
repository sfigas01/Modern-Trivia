type ProcessWithEnvLoader = NodeJS.Process & {
  loadEnvFile?: (path?: string) => void;
};

let hasLoadedEnvironment = false;

export function loadEnvironment(): void {
  if (hasLoadedEnvironment) {
    return;
  }

  hasLoadedEnvironment = true;

  const processWithEnvLoader = process as ProcessWithEnvLoader;
  if (typeof processWithEnvLoader.loadEnvFile !== 'function') {
    return;
  }

  try {
    processWithEnvLoader.loadEnvFile();
  } catch (error) {
    const envError = error as NodeJS.ErrnoException;
    if (envError.code !== 'ENOENT') {
      throw error;
    }
  }
}
