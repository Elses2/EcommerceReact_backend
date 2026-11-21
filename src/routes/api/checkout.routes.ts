import { Router } from "express";
import { checkoutController } from "../../controllers/api/checkout.controller.js";
import { authenticate } from "../../middlewares/route/authenticate.middleware.js";

/**
 * @fileoverview Router de la API del checkout (spec §19/§24).
 *
 * Las rutas protegidas (GET /, POST /) exigen JWT.
 * La confirmación GET /confirmation/:token es pública (spec §19/D7):
 * el token es la credencial, no se requiere sesión.
 */
const router = Router();

// Confirmación JSON pública (sin authenticate): el token es la credencial.
router.get("/confirmation/:token", checkoutController.getConfirmation);

router.use(authenticate);

router.get("/", checkoutController.showCheckout);
router.post("/", checkoutController.submitCheckout);

export default router;
