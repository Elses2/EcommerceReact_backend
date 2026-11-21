import { Router } from "express";
import productsRoutes from "./api/products.routes.js";
import cartRoutes from "./api/cart.routes.js";
import checkoutRoutes from "./api/checkout.routes.js";
import ordersRoutes from "./api/orders.routes.js";
import authRoutes from "./api/auth.routes.js";
import readsRoutes from "./api/reads.routes.js";

/**
 * Router principal que agrupa y centraliza todos los sub-routers de la API REST.
 */
const router = Router();

router.use("/products", productsRoutes);
router.use("/cart", cartRoutes);
router.use("/checkout", checkoutRoutes);
router.use("/orders", ordersRoutes);
router.use("/auth", authRoutes);
router.use(readsRoutes);

/**
 * Router consolidado de la API listo para ser montado en `/api`.
 */
export default router;
