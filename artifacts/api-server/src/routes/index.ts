import { Router, type IRouter } from "express";
import healthRouter from "./health";
import profileRouter from "./profile";
import statsRouter from "./stats";
import memoriesRouter from "./memories";
import conversationsRouter from "./conversations";
import voiceProfilesRouter from "./voiceProfiles";
import historyRouter from "./history";
import phoneAccessRouter from "./phoneAccess";
import mcpBridgeRouter from "./mcpBridge";

const router: IRouter = Router();

router.use(healthRouter);
router.use(profileRouter);
router.use(statsRouter);
router.use(memoriesRouter);
router.use(conversationsRouter);
router.use(voiceProfilesRouter);
router.use(historyRouter);
router.use(phoneAccessRouter);
router.use(mcpBridgeRouter);

export default router;
