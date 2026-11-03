import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScopeButton } from '@/components/ui/button';
import { ScopeScreenHeading } from '@/components/ui/screen';
import { ScopeCard } from '@/components/ui/surfaces';
import { ScopeNotice } from '@/components/ui/states';
import { ScopeText } from '@/components/ui/text';
import { ScopeTextField } from '@/components/ui/text-field';
import { ObjectiveSourceSheet } from '@/features/objectives/objective-source-sheet';
import { RequirementReviewItem } from '@/features/objectives/requirement-review-item';
import {
  buildCreateObjectiveBody,
  buildProposalRequestBody,
  countCodePoints,
  describeSelection,
  formatSectionLabel,
  isAlreadyInList,
  MAX_OBJECTIVE_CODE_POINTS,
  MAX_OBJECTIVE_REQUIREMENTS,
  summarizeReview,
  validateConfirm,
  validateIntake,
  type ConfirmValidationCode,
  type IntakeValidationCode
} from '@/features/objectives/review-draft';
import { useDiscardGuard } from '@/features/objectives/use-discard-guard';
import { useObjectiveFlow } from '@/features/objectives/use-objective-flow';
import {
  createObjectiveRequest,
  proposeObjectiveRequirementsRequest
} from '@/lib/api/scope-api';
import { useAuthenticatedRequest } from '@/lib/auth/session-provider';
import {
  mapObjectiveCreateError,
  mapObjectiveProposalError
} from '@/lib/errors/objective-error-mapper';
import { queryKeys } from '@/lib/query/query-client';
import { makeStyles, useTheme } from '@/lib/theme/theme-provider';
import { layout, radii, spacing, typography } from '@/lib/theme/tokens';
import {
  OBJECTIVE_TYPE_LABELS,
  OBJECTIVE_TYPES,
  type ObjectiveSourceRangeVM,
  type ObjectiveTypeToken,
  type ReviewItem
} from '@/types/objectives';

const UNDO_WINDOW_MS = 8_000;

const INTAKE_MESSAGES: Record<IntakeValidationCode, string> = {
  OBJECTIVE_TYPE_REQUIRED: 'Elegí el tipo de objetivo.',
  TITLE_REQUIRED: 'Ponele un nombre al objetivo.',
  TITLE_TOO_LONG: 'El nombre del objetivo es demasiado largo.',
  TEXT_REQUIRED: 'Pegá el texto del objetivo.',
  TEXT_TOO_MANY_CODE_POINTS:
    'El texto del objetivo es demasiado largo para analizarlo de una vez. Probá acortarlo sin perder la parte que describe los requisitos.',
  REQUEST_BODY_TOO_LARGE:
    'El contenido es demasiado largo para enviarlo completo. Acortá el texto del objetivo sin perder la parte que describe los requisitos.'
};

const CONFIRM_MESSAGES: Record<ConfirmValidationCode, string> = {
  NO_REQUIREMENTS: 'Agregá al menos un requisito para confirmar el objetivo.',
  TOO_MANY_REQUIREMENTS: `Un objetivo puede tener hasta ${MAX_OBJECTIVE_REQUIREMENTS} requisitos. Eliminá los que no sean centrales para confirmarlo.`,
  BLANK_REQUIREMENT: 'Hay un requisito sin texto. Completalo o eliminalo.',
  REQUEST_BODY_TOO_LARGE:
    'El objetivo revisado quedó demasiado grande para confirmarlo. Volvé a editar el objetivo y acortá el texto original antes de analizarlo nuevamente.'
};

/**
 * Preparar un objetivo: carga y revisión de requisitos.
 *
 * Dos fases en una sola pantalla, porque la revisión depende de un snapshot que
 * sólo existe en memoria: navegar a otra ruta y volver lo perdería.
 *
 * NADA se persiste. La propuesta es transitoria por contrato, y guardar el
 * texto privado de un objetivo en el dispositivo para sobrevivir a un cierre de
 * la app sería crear una copia de datos privados que nadie pidió. Si la app se
 * cierra durante la revisión, la revisión se pierde: está documentado como
 * limitación aceptada.
 */
export function ObjectiveIntakeScreen() {
  const styles = useStyles();
  const router = useRouter();
  const queryClient = useQueryClient();
  const request = useAuthenticatedRequest();
  const insets = useSafeAreaInsets();
  const { state, dispatch, actions } = useObjectiveFlow();

  // Identidad de petición: una respuesta vieja que llega tarde NUNCA pisa el
  // estado actual. No alcanza con abortar, porque no toda capa de red honra la
  // señal.
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cerrojo del MISMO tick: `confirming` en el estado se aplica en el próximo
  // render, así que dos toques rápidos podrían pasar los dos.
  const analyzeLockRef = useRef(false);
  const confirmLockRef = useRef(false);

  const [sourceItem, setSourceItem] = useState<ReviewItem | null>(null);

  const reviewActive = state.phase === 'review' && state.draft !== null;
  // Hay algo que perder: datos cargados en el intake o una revision en curso.
  const hasUnsavedWork =
    reviewActive ||
    state.intake.objectiveType !== null ||
    state.intake.title.trim().length > 0 ||
    state.intake.rawObjectiveText.trim().length > 0;
  const discardGuard = useDiscardGuard(hasUnsavedWork);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    },
    []
  );

  useEffect(() => {
    if (state.lastRemoved === null) return undefined;
    undoTimerRef.current = setTimeout(() => actions.clearUndo(), UNDO_WINDOW_MS);
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, [state.lastRemoved, actions]);

  const analyze = useCallback(async () => {
    if (analyzeLockRef.current || state.analyzing) return;

    const validation = validateIntake(state.intake);
    if (validation !== null) {
      dispatch({ type: 'failLocally', message: INTAKE_MESSAGES[validation] });
      return;
    }

    const objectiveType = state.intake.objectiveType as ObjectiveTypeToken;
    const snapshot = {
      objectiveType,
      title: state.intake.title,
      // El texto EXACTO que se envía queda congelado acá. Desde este punto es
      // la única autoridad: al confirmar no se relee del campo de entrada.
      rawObjectiveText: state.intake.rawObjectiveText
    };

    analyzeLockRef.current = true;
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    dispatch({ type: 'analyzeStarted' });

    try {
      const proposal = await proposeObjectiveRequirementsRequest(
        request,
        buildProposalRequestBody(snapshot),
        controller.signal
      );
      if (requestId !== requestIdRef.current) return;
      dispatch({ type: 'analyzeSucceeded', snapshot, proposal });
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      const mapped = mapObjectiveProposalError(error);
      dispatch({
        type: 'analyzeFailed',
        message: mapped.message,
        retryable: mapped.retryable
      });
    } finally {
      analyzeLockRef.current = false;
    }
  }, [dispatch, request, state.analyzing, state.intake]);

  const confirm = useCallback(async () => {
    if (confirmLockRef.current || state.confirming || state.draft === null) {
      return;
    }

    const validation = validateConfirm(state.draft);
    if (validation !== null) {
      dispatch({
        type: 'failLocally',
        message: CONFIRM_MESSAGES[validation.code],
        localKey: validation.localKey
      });
      return;
    }

    confirmLockRef.current = true;
    dispatch({ type: 'confirmStarted' });

    try {
      const objective = await createObjectiveRequest(
        request,
        buildCreateObjectiveBody(state.draft)
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.objectives });
      // Salida legitima: el objetivo ya esta guardado, no se pregunta.
      discardGuard.leave(() =>
        router.replace(
          `/objectives/${encodeURIComponent(objective.objectiveReference)}`
        )
      );
    } catch (error) {
      // El borrador queda intacto y la propuesta NO se vuelve a pedir: el
      // proveedor no se llama otra vez por un fallo de creación.
      const mapped = mapObjectiveCreateError(error);
      dispatch({
        type: 'confirmFailed',
        message: mapped.message,
        retryable: mapped.retryable
      });
    } finally {
      confirmLockRef.current = false;
    }
  }, [discardGuard, dispatch, queryClient, request, router, state.confirming, state.draft]);

  const showSource = useCallback((item: ReviewItem) => {
    setSourceItem(item);
  }, []);

  const codePoints = countCodePoints(state.intake.rawObjectiveText);
  const nearLimit = codePoints > MAX_OBJECTIVE_CODE_POINTS * 0.8;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: spacing.huge + insets.bottom }
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.inner}>
          <ScopeScreenHeading
            eyebrow="Objetivos"
            title={reviewActive ? 'Revisá los requisitos' : 'Nuevo objetivo'}
            description={
              reviewActive
                ? 'Scope propuso estos requisitos a partir del texto. Revisalos: lo que confirmes es lo que se va a analizar.'
                : 'Pegá el texto de la búsqueda, beca o convocatoria. Scope va a identificar sus requisitos para que los revises.'
            }
          />

          {state.error ? (
            <ScopeNotice tone="warning" title="No pudimos continuar">
              <ScopeText
                variant="small"
                style={styles.warningText}
                accessibilityLiveRegion="polite"
              >
                {state.error}
              </ScopeText>
            </ScopeNotice>
          ) : null}

          {!reviewActive ? (
            <IntakeForm
              objectiveType={state.intake.objectiveType}
              title={state.intake.title}
              rawObjectiveText={state.intake.rawObjectiveText}
              analyzing={state.analyzing}
              codePoints={codePoints}
              nearLimit={nearLimit}
              onSelectType={actions.setObjectiveType}
              onChangeField={actions.setIntakeField}
              onAnalyze={() => void analyze()}
            />
          ) : (
            <ReviewList
              onEdit={actions.editItem}
              onRemove={actions.removeItem}
              onMove={actions.moveItem}
              onShowSource={showSource}
              items={state.draft?.items ?? []}
              summary={summarizeReview(state.draft!, state.proposedCount)}
              selectionNotice={describeSelection(state.draft!, state.proposedCount)}
              omittedItems={state.draft?.omittedItems ?? []}
              onUseOmitted={actions.useOmittedItem}
              onReplaceWithOmitted={actions.replaceWithOmittedItem}
              nonFormativeConditions={state.draft?.nonFormativeConditions ?? []}
              unresolvedPassageCount={state.draft?.unresolvedPassageCount ?? 0}
              confirming={state.confirming}
              canUndo={state.lastRemoved !== null}
              onUndo={actions.undoRemove}
              onAdd={actions.addManualItem}
              onDiscard={actions.discardReview}
              onConfirm={() => void confirm()}
            />
          )}
        </View>
      </ScrollView>

      <ObjectiveSourceSheet
        visible={sourceItem !== null}
        excerpt={sourceItem?.primaryExcerpt ?? null}
        range={(sourceItem?.excerptRange ?? null) as ObjectiveSourceRangeVM | null}
        sourceText={state.draft?.snapshot.rawObjectiveText ?? ''}
        sectionLabel={sourceItem?.sourceSectionLabel ?? null}
        onClose={() => setSourceItem(null)}
      />
    </KeyboardAvoidingView>
  );
}

function IntakeForm({
  objectiveType,
  title,
  rawObjectiveText,
  analyzing,
  codePoints,
  nearLimit,
  onSelectType,
  onChangeField,
  onAnalyze
}: {
  objectiveType: ObjectiveTypeToken | null;
  title: string;
  rawObjectiveText: string;
  analyzing: boolean;
  codePoints: number;
  nearLimit: boolean;
  onSelectType: (value: ObjectiveTypeToken) => void;
  onChangeField: (field: 'title' | 'rawObjectiveText', value: string) => void;
  onAnalyze: () => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.form}>
      <View style={styles.block}>
        <ScopeText variant="smallStrong" tone="strong">
          Tipo de objetivo
        </ScopeText>
        {/* SIN valor por defecto: elegir el tipo es una decisión de la persona. */}
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Tipo de objetivo"
          style={styles.typeGrid}
        >
          {OBJECTIVE_TYPES.map((type) => {
            const selected = objectiveType === type;
            return (
              <Pressable
                key={type}
                testID={`objective-type-${type}`}
                accessibilityRole="radio"
                accessibilityState={{ selected, checked: selected }}
                accessibilityLabel={OBJECTIVE_TYPE_LABELS[type]}
                disabled={analyzing}
                onPress={() => onSelectType(type)}
                style={[styles.typeOption, selected && styles.typeOptionSelected]}
              >
                <ScopeText
                  variant="small"
                  style={{
                    color: selected ? colors.action.onPrimary : colors.text.default
                  }}
                >
                  {OBJECTIVE_TYPE_LABELS[type]}
                </ScopeText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScopeTextField
        testID="objective-title"
        label="Nombre del objetivo"
        value={title}
        onChangeText={(value) => onChangeField('title', value)}
        editable={!analyzing}
        placeholder="Ej.: Analista de datos en una empresa de salud"
        autoCapitalize="sentences"
      />

      <View style={styles.block}>
        <ScopeText variant="smallStrong" tone="strong">
          Texto del objetivo
        </ScopeText>
        <TextInput
          testID="objective-text"
          accessibilityLabel="Texto del objetivo"
          multiline
          value={rawObjectiveText}
          onChangeText={(value) => onChangeField('rawObjectiveText', value)}
          editable={!analyzing}
          placeholder="Pegá acá la descripción completa de la búsqueda, beca o convocatoria."
          placeholderTextColor={colors.text.subtle}
          style={styles.textarea}
        />
        {/* El contador sólo aparece cerca del límite: mostrarlo siempre sería
            ruido en el 99 % de los casos. */}
        {nearLimit ? (
          <ScopeText variant="caption" tone="warning">
            {codePoints.toLocaleString('es-AR')} de{' '}
            {MAX_OBJECTIVE_CODE_POINTS.toLocaleString('es-AR')} caracteres.
          </ScopeText>
        ) : null}
        <ScopeText variant="caption" tone="subtle">
          El texto se envía tal cual lo pegaste. Scope lo usa para citar
          literalmente de dónde sale cada requisito.
        </ScopeText>
      </View>

      <ScopeButton
        testID="objective-analyze"
        fullWidth
        label="Analizar objetivo"
        loadingLabel="Identificando requisitos"
        loading={analyzing}
        onPress={onAnalyze}
      />

      {analyzing ? (
        <ScopeText
          variant="small"
          tone="muted"
          accessibilityLiveRegion="polite"
          style={styles.centered}
        >
          Identificando requisitos… Puede tardar hasta un minuto.
        </ScopeText>
      ) : null}
    </View>
  );
}

function ReviewList({
  items,
  summary,
  selectionNotice,
  omittedItems,
  onUseOmitted,
  onReplaceWithOmitted,
  nonFormativeConditions,
  unresolvedPassageCount,
  confirming,
  canUndo,
  onEdit,
  onRemove,
  onMove,
  onShowSource,
  onUndo,
  onAdd,
  onDiscard,
  onConfirm
}: {
  items: ReviewItem[];
  summary: string;
  selectionNotice: string | null;
  omittedItems: ReviewItem[];
  onUseOmitted: (localKey: string) => void;
  onReplaceWithOmitted: (omittedKey: string, targetKey: string) => void;
  nonFormativeConditions: string[];
  unresolvedPassageCount: number;
  confirming: boolean;
  canUndo: boolean;
  onEdit: (localKey: string, text: string) => void;
  onRemove: (localKey: string) => void;
  onMove: (localKey: string, direction: -1 | 1) => void;
  onShowSource: (item: ReviewItem) => void;
  onUndo: () => void;
  onAdd: () => void;
  onDiscard: () => void;
  onConfirm: () => void;
}) {
  const styles = useStyles();
  const [replacing, setReplacing] = useState<string | null>(null);
  const full = items.length >= MAX_OBJECTIVE_REQUIREMENTS;
  return (
    <View style={styles.form}>
      <ScopeCard tone="muted" style={styles.summaryCard}>
        <ScopeText variant="small" tone="muted" testID="review-summary">
          {summary}
        </ScopeText>
        {unresolvedPassageCount > 0 ? (
          <ScopeText variant="caption" tone="subtle">
            Hay {unresolvedPassageCount}{' '}
            {unresolvedPassageCount === 1 ? 'pasaje' : 'pasajes'} del objetivo
            que no se pudieron convertir en un requisito. Podés agregarlos a
            mano si te parecen importantes.
          </ScopeText>
        ) : null}
      </ScopeCard>

      {selectionNotice !== null ? (
        <ScopeNotice tone="info" title="Hubo una selección">
          <ScopeText variant="small" testID="review-selection-notice">
            {selectionNotice}
          </ScopeText>
        </ScopeNotice>
      ) : null}

      {canUndo ? (
        <ScopeNotice tone="info" title="Requisito eliminado">
          <ScopeButton
            testID="review-undo"
            variant="ghost"
            label="Deshacer"
            onPress={onUndo}
          />
        </ScopeNotice>
      ) : null}

      <View style={styles.itemList}>
        {items.map((item, index) => (
          <RequirementReviewItem
            key={item.localKey}
            item={item}
            index={index}
            total={items.length}
            onEdit={onEdit}
            onRemove={onRemove}
            onMove={onMove}
            onShowSource={onShowSource}
          />
        ))}
      </View>

      <ScopeButton
        testID="review-add"
        variant="secondary"
        fullWidth
        label="Agregar un requisito"
        onPress={onAdd}
        disabled={items.length >= MAX_OBJECTIVE_REQUIREMENTS}
      />

      {omittedItems.length > 0 ? (
        <ScopeCard tone="muted" style={styles.summaryCard}>
          <ScopeText variant="small" tone="muted">
            Requisitos que quedaron afuera ({omittedItems.length}).{' '}
            {full
              ? `La lista ya tiene ${MAX_OBJECTIVE_REQUIREMENTS}: podés reemplazar uno por cualquiera de estos.`
              : 'Podés sumar cualquiera a la lista.'}
          </ScopeText>
          {omittedItems.map((item) => {
            const section = formatSectionLabel(item.sourceSectionLabel);
            const duplicate = isAlreadyInList(items, item);
            return (
              <View key={item.localKey}>
                <ScopeText variant="small">{item.text}</ScopeText>
                {section ? (
                  <ScopeText variant="caption" tone="subtle">
                    {section}
                  </ScopeText>
                ) : null}
                {duplicate ? (
                  <ScopeText variant="caption" tone="subtle">
                    Ya está en la lista.
                  </ScopeText>
                ) : null}
                {full ? (
                  <ScopeButton
                    testID={`review-replace-omitted-${item.localKey}`}
                    variant="ghost"
                    label="Reemplazar uno…"
                    accessibilityHint={`Elegí qué requisito sale para sumar: ${item.text}`}
                    disabled={duplicate}
                    onPress={() =>
                      setReplacing(replacing === item.localKey ? null : item.localKey)
                    }
                  />
                ) : (
                  <ScopeButton
                    testID={`review-use-omitted-${item.localKey}`}
                    variant="ghost"
                    label="Usar este requisito"
                    accessibilityHint={`Agrega al final: ${item.text}`}
                    disabled={duplicate}
                    onPress={() => onUseOmitted(item.localKey)}
                  />
                )}
                {full && replacing === item.localKey
                  ? items.map((target, index) => (
                      <ScopeButton
                        key={target.localKey}
                        testID={`review-replace-target-${target.localKey}`}
                        variant="ghost"
                        label={`Reemplazar ${index + 1}. ${target.text || '(sin texto)'}`}
                        onPress={() => {
                          onReplaceWithOmitted(item.localKey, target.localKey);
                          setReplacing(null);
                        }}
                      />
                    ))
                  : null}
              </View>
            );
          })}
        </ScopeCard>
      ) : null}

      {nonFormativeConditions.length > 0 ? (
        <ScopeCard tone="muted" style={styles.summaryCard}>
          <ScopeText variant="small" testID="review-non-formative-title">
            Condiciones del aviso que no se analizan con tu formación
          </ScopeText>
          <ScopeText variant="caption" tone="subtle">
            Siguen siendo parte de la oportunidad, pero ninguna credencial las
            acredita. Si querés analizar alguna igual, agregala como requisito.
          </ScopeText>
          {nonFormativeConditions.map((condition, index) => (
            <ScopeText key={`${index}-${condition}`} variant="small">
              • {condition}
            </ScopeText>
          ))}
        </ScopeCard>
      ) : null}

      <ScopeButton
        testID="review-confirm"
        fullWidth
        label="Confirmar objetivo"
        loadingLabel="Confirmando"
        loading={confirming}
        onPress={onConfirm}
        accessibilityHint="Guarda el objetivo con los requisitos que revisaste"
      />

      <ScopeButton
        testID="review-discard"
        variant="ghost"
        fullWidth
        label="Volver a editar el texto"
        disabled={confirming}
        onPress={onDiscard}
        accessibilityHint="Descarta esta propuesta y vuelve al texto del objetivo"
      />

      <ScopeText variant="caption" tone="subtle" style={styles.centered}>
        Si volvés a editar el texto, esta propuesta se descarta y hay que
        analizar de nuevo.
      </ScopeText>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.surface.background
  },
  content: {
    flexGrow: 1,
    paddingTop: spacing.xl,
    paddingHorizontal: layout.screenPaddingHorizontal,
    alignItems: 'center'
  },
  inner: {
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    gap: spacing.xl
  },
  form: {
    gap: spacing.lg
  },
  block: {
    gap: spacing.sm
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  typeOption: {
    minHeight: layout.touchTarget,
    justifyContent: 'center',
    borderRadius: radii.control,
    borderWidth: layout.hairline,
    borderColor: colors.border.strong,
    backgroundColor: colors.surface.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm
  },
  typeOptionSelected: {
    backgroundColor: colors.action.primary,
    borderColor: colors.action.primaryBorder
  },
  textarea: {
    minHeight: 200,
    borderRadius: radii.control,
    borderWidth: layout.hairline,
    borderColor: colors.border.strong,
    backgroundColor: colors.surface.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.text.strong,
    fontSize: typography.body.fontSize,
    fontFamily: typography.body.fontFamily,
    textAlignVertical: 'top'
  },
  summaryCard: {
    gap: spacing.xs
  },
  itemList: {
    gap: spacing.md
  },
  centered: {
    textAlign: 'center'
  },
  warningText: {
    color: colors.status.warning
  }
}));
