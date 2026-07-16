import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import employeesRouter from "./employees";
import departmentsRouter from "./departments";
import locationsRouter from "./locations";
import transactionsRouter from "./transactions";
import rewardsRouter from "./rewards";
import redemptionsRouter from "./redemptions";
import goalsRouter from "./goals";
import settingsRouter from "./settings";
import dashboardRouter from "./dashboard";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(employeesRouter);
router.use(departmentsRouter);
router.use(locationsRouter);
router.use(transactionsRouter);
router.use(rewardsRouter);
router.use(redemptionsRouter);
router.use(goalsRouter);
router.use(settingsRouter);
router.use(dashboardRouter);
router.use(storageRouter);

export default router;
