import nextWorker from "./.open-next/worker.js";
import jobsWorker from "../worker/src/worker.ts";

export default {
  fetch(request, env, ctx) {
    return nextWorker.fetch(request, env, ctx);
  },
  scheduled(controller, env, ctx) {
    return jobsWorker.scheduled(controller, env, ctx);
  },
};
