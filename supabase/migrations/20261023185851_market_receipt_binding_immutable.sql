-- A provider receipt cannot be attached to a different order after creation.
-- Order binding must run at INSERT, while the order reservation is locked.
CREATE FUNCTION marketplace_ops.immutable_receipt_binding() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    RAISE EXCEPTION 'ORDER_PAYMENT_IMMUTABLE';
  END IF;
  IF OLD.order_id IS NOT NULL AND OLD.status IN ('completed','failed')
    AND NEW.tx_id IS DISTINCT FROM OLD.tx_id THEN
    RAISE EXCEPTION 'FINAL_ORDER_PAYMENT_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION marketplace_ops.immutable_receipt_binding() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER market_immutable_receipt_binding BEFORE UPDATE OF order_id, tx_id
ON public.chat_payments FOR EACH ROW EXECUTE FUNCTION marketplace_ops.immutable_receipt_binding();
