import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import employeesRouter from "./employees";
import departmentsRouter from "./departments";
import locationsRouter from "./locations";
import budgetsRouter from "./budgets";
import transactionsRouter from "./transactions";
import rewardsRouter from "./rewards";
import redemptionsRouter from "./redemptions";
import goalsRouter from "./goals";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(employeesRouter);
router.use(departmentsRouter);
router.use(locationsRouter);
router.use(budgetsRouter);
router.use(transactionsRouter);
router.use(rewardsRouter);
router.use(redemptionsRouter);
router.use(goalsRouter);
router.use(dashboardRouter);

export default router;
