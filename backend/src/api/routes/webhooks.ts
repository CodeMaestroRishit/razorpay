import { Router } from "express";
import { handleWebhook } from "../../webhooks/receiver.js";

export const webhooksRouter = Router();

webhooksRouter.post("/:provider", handleWebhook);
