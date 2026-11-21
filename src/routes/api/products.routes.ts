import { Router } from "express";
import { productsController } from "../../controllers/api/products.controller.js";
import { validateId } from "../../middlewares/route/validate-id.middleware.js";

/**
 * @fileoverview Router de la API de productos (spec §6.8/§6.12/§6.13).
 *
 * Endpoints JSON públicos para listado con sort, detalle + related,
 * y búsqueda. Las rutas son PÚBLICAS (sin authenticate).
 *
 * Decisión: se implementa dentro del scaffold existente (opción a) y
 * se elimina el guard legacy `validateCollectionId` que siempre devolvía
 * 400 (deuda #91 resuelta para esta colección, al igual que §25.3 para
 * categories). La semántica real de §6.9/§6.12 ahora aplica: 400 solo
 * para id no numérico o sort inválido, 404 para recurso inexistente.
 */
const router = Router();

router.get("/", productsController.getProducts);
router.get("/:productId", validateId("productId"), productsController.getProductDetail);

export default router;
