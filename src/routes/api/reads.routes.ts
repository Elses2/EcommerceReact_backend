import { Router } from "express";
import { readsController } from "../../controllers/api/reads.controller.js";

/**
 * @fileoverview Router de lecturas públicas del home y categorías (spec §6.6/§6.6b/§6.7/§6.9).
 *
 * Estas rutas son PÚBLICAS (sin authenticate): el home y las categorías
 * no requieren sesión ni JWT. Se montan en `/api` desde `index.routes.ts`.
 */
const router = Router();

router.get("/home", readsController.getHome);
router.get("/categories", readsController.listCategories);
router.get("/categories/:categoryId", readsController.getCategory);
router.get("/search", readsController.searchProducts);
router.get("/health", readsController.getHealth);

export default router;
