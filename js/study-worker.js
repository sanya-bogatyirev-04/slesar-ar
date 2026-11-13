import { runStudy } from "./study.js";
self.onmessage = async ({ data }) => {
  try {
    const result = await runStudy(data.config, { ...data.options, onProgress: (progress) => self.postMessage({ progress }) });
    self.postMessage({ result });
  } catch (error) { self.postMessage({ error: error.message }); }
};
