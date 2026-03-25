-- ═══════════════════════════════════════════════════════
-- TAURIX · Migraciones SQL — Nuevas tablas
-- Ejecutar en Supabase SQL Editor
-- ═══════════════════════════════════════════════════════

-- ── 1. Facturas recurrentes ──
CREATE TABLE IF NOT EXISTS facturas_recurrentes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  concepto TEXT NOT NULL,
  base NUMERIC(12,2) NOT NULL DEFAULT 0,
  iva INTEGER DEFAULT 21,
  irpf_retencion NUMERIC(5,2) DEFAULT 0,
  tipo_operacion TEXT DEFAULT 'nacional',
  frecuencia TEXT NOT NULL DEFAULT 'mensual'
    CHECK (frecuencia IN ('mensual','bimestral','trimestral','semestral','anual')),
  proxima_generacion DATE NOT NULL,
  fecha_fin DATE,
  cliente_id UUID,
  cliente_nombre TEXT,
  cliente_nif TEXT,
  notas TEXT,
  lineas JSONB,
  activa BOOLEAN DEFAULT true,
  veces_generada INTEGER DEFAULT 0,
  ultima_generacion DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE facturas_recurrentes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "facturas_recurrentes_user" ON facturas_recurrentes
  FOR ALL USING (auth.uid() = user_id);


-- ── 2. Plantillas de usuario ──
CREATE TABLE IF NOT EXISTS plantillas_usuario (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  nombre TEXT NOT NULL,
  concepto TEXT,
  notas TEXT,
  lineas JSONB,
  color_principal TEXT DEFAULT '#1a56db',
  texto_pie TEXT,
  iban_visible TEXT,
  logo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE plantillas_usuario ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plantillas_usuario_user" ON plantillas_usuario
  FOR ALL USING (auth.uid() = user_id);


-- ── 3. Albaranes (usa tabla de presupuestos con estado='albaran') ──
-- No se necesita tabla nueva. Los albaranes son presupuestos con estado='albaran'.
-- Opcionalmente, añadir campos extra si no existen:
ALTER TABLE presupuestos ADD COLUMN IF NOT EXISTS albaran_numero TEXT;
ALTER TABLE presupuestos ADD COLUMN IF NOT EXISTS albaran_fecha DATE;
ALTER TABLE presupuestos ADD COLUMN IF NOT EXISTS factura_id UUID;


-- ── 4. Plantillas de presupuesto del usuario ──
-- (ya se usa presupuesto_plantillas — asegurar que existe)
CREATE TABLE IF NOT EXISTS presupuesto_plantillas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  nombre TEXT NOT NULL,
  concepto TEXT,
  notas TEXT,
  lineas JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE presupuesto_plantillas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "presupuesto_plantillas_user" ON presupuesto_plantillas
  FOR ALL USING (auth.uid() = user_id);


-- ── 5. Índices para rendimiento ──
CREATE INDEX IF NOT EXISTS idx_facturas_recurrentes_user
  ON facturas_recurrentes(user_id, activa, proxima_generacion);

CREATE INDEX IF NOT EXISTS idx_plantillas_usuario_user
  ON plantillas_usuario(user_id);

CREATE INDEX IF NOT EXISTS idx_presupuestos_estado
  ON presupuestos(user_id, estado);
