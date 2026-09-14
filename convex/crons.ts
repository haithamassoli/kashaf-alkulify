import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// ponytail: hourly rebuild catches pipeline lesson writes; admin edits schedule
// their own rebuild.
crons.interval("rebuild series", { hours: 1 }, internal.content.rebuildSeries);

export default crons;
