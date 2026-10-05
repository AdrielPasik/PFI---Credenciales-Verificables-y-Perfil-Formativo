/**
 * View models del PLANO DE PLATAFORMA -- slice S6a, READ-ONLY.
 *
 * Son la frontera tipada entre los contratos de S3 (`GET /admin/issuers` y
 * `GET /admin/issuers/:issuerId/memberships`) y los componentes de `/admin`.
 * Ningun componente recibe el DTO crudo del backend.
 *
 * POR QUE UN MODELO APARTE DE `issuer-context`. `IssuerContextState` describe
 * lo que la persona autenticada PUEDE OPERAR -- su plano institucional, que
 * nace de `IssuerMembership`. Esto describe lo que un PlatformAdmin PUEDE
 * OBSERVAR, que es todo el padron de instituciones, tenga o no membership
 * sobre ellas. Mezclarlos invitaria a que un componente use uno donde
 * corresponde el otro, que es exactamente la confusion de planos que el
 * backend evita con dos tablas separadas.
 *
 * NINGUN CAMPO INVENTADO: todo lo de aca sale del contrato existente o es una
 * etiqueta de presentacion derivada de el. En particular NO existen, porque no
 * existen en el sistema: verificacion institucional, KYB, acreditacion, ni el
 * VALOR de `did`/`walletAddress`.
 */

/** Los tres valores reales de `IssuerAuthorizationStatus`. */
export type IssuerAuthorizationStatus = 'pending' | 'authorized' | 'revoked';

/** Los tres valores reales de `IssuerMembershipRole`. */
export type IssuerMembershipRole = 'admin' | 'operator' | 'viewer';

/** Los tres valores reales de `IssuerMembershipStatus`. */
export type IssuerMembershipStatus = 'active' | 'pending' | 'revoked';

/**
 * Readiness tecnica, en booleanos. NUNCA el DID ni la walletAddress: el
 * backend no los devuelve en esta superficie, y no hacen falta para operar
 * /admin.
 */
export interface AdminTechnicalIdentityVM {
  didConfigured: boolean;
  walletConfigured: boolean;
  /**
   * `authorizationStatus === 'authorized' && didConfigured &&
   * walletConfigured`, calculado por el backend.
   *
   * Es la precondicion real de `IssuersService.assertIssuerCanIssue`. La UI la
   * muestra pero NO la recalcula: duplicar la regla en el cliente es
   * exactamente como se desincronizan.
   */
  readyToIssue: boolean;
  /**
   * Resumen de presentacion: "Lista" / "Pendiente".
   *
   * Una institucion recien dada de alta por S5b es `authorized` con
   * `readyToIssue: false`, y eso NO es un error -- es el estado correcto de
   * algo habilitado operativamente pero sin identidad tecnica todavia. De ahi
   * que esta etiqueta sea neutra y no una advertencia.
   */
  readinessLabel: string;
}

export interface AdminMembershipCountsVM {
  /** Memberships `active`: las unicas que habilitan operar. */
  active: number;
  /** Todas, cualquiera sea su status. */
  total: number;
  /** "3 activos de 5" / "Sin miembros". */
  summaryLabel: string;
}

export interface AdminCatalogCountsVM {
  academicCourses: number;
  programs: number;
  curriculumVersions: number;
  programCourses: number;
}

export interface AdminIssuerVM {
  issuerReference: string;
  name: string;
  /**
   * `Issuer.legalName` tal como esta, incluido `null`.
   *
   * La columna es nullable y hay filas historicas sin razon social. `null` se
   * representa como ausencia en la UI, nunca como `""`.
   */
  legalName: string | null;
  authorizationStatus: IssuerAuthorizationStatus;
  /**
   * "Habilitada" / "Pendiente de habilitacion" / "Habilitacion revocada".
   *
   * HABILITACION OPERACIONAL DENTRO DE SCOPE. Nunca "verificada", "validada"
   * ni "acreditada": ese concepto no esta modelado en este sistema y la UI no
   * puede insinuarlo.
   */
  authorizationLabel: string;
  technicalIdentity: AdminTechnicalIdentityVM;
  membershipCounts: AdminMembershipCountsVM;
  catalogCounts: AdminCatalogCountsVM;
  createdAtLabel: string;
}

export interface AdminIssuerListVM {
  items: AdminIssuerVM[];
}

export interface AdminMembershipVM {
  userReference: string;
  /**
   * `User.email` tal como esta, incluido `null`. La UI muestra "Sin email"
   * cuando falta; NUNCA se convierte a `""`, porque "sin email" y "email
   * vacio" son estados semanticamente distintos.
   */
  email: string | null;
  /** Siempre un string no vacio: lo calcula el backend con su unico helper. */
  displayLabel: string;
  role: IssuerMembershipRole;
  roleLabel: string;
  status: IssuerMembershipStatus;
  statusLabel: string;
  createdAtLabel: string;
}

/** Identificacion minima del issuer consultado, para encabezar la lista. */
export interface AdminMembershipsIssuerVM {
  issuerReference: string;
  name: string;
}

export interface AdminIssuerMembershipsVM {
  issuer: AdminMembershipsIssuerVM;
  items: AdminMembershipVM[];
}

// ---------------------------------------------------------------------------
// S6b -- ACCIONES ADMINISTRATIVAS
// ---------------------------------------------------------------------------

/**
 * Resultado de `POST /admin/users/resolve` (S4).
 *
 * NO TIENE `userId`, Y NO PUEDE TENERLO. El backend deliberadamente no lo
 * devuelve: si el cliente pudiera capturar un identificador de usuario,
 * terminaria transportandolo como si fuera autoridad. Todo el frontend
 * administrativo opera POR EMAIL, y S5a/S5b vuelven a resolver la persona
 * server-side antes de otorgar nada.
 *
 * Esto es confirmacion VISUAL, no autorizacion: entre el resolve y el confirm
 * la persona puede dejar de ser elegible, y en ese caso la mutacion devuelve
 * el 404 uniforme. La invariante esta congelada por test.
 */
export interface ResolvedAdminUserVM {
  email: string;
  displayLabel: string;
}

/**
 * Resultado de `POST /admin/issuers/:issuerId/memberships` (S5a).
 *
 * Reusa `AdminMembershipVM` sin estrecharlo: `email` conserva
 * `string | null`, contrato congelado en S3. En este camino la persona
 * siempre tiene email -- la resolucion lo exige -- pero el VM sigue la forma
 * del backend y nunca convierte `null` en `""`.
 */
export interface AdminMembershipGrantResultVM {
  issuer: AdminMembershipsIssuerVM;
  membership: AdminMembershipVM;
}

/**
 * El Issuer tal como lo devuelve `POST /admin/issuers` (S5b).
 *
 * Misma forma que `AdminIssuerVM` menos los conteos, que el POST no trae
 * (nace sin catalogo y con una sola membership). La informacion administrativa
 * que se muestra despues sale siempre de los GET canonicos, no de aca.
 */
export interface AdminProvisionedIssuerVM {
  issuerReference: string;
  name: string;
  legalName: string | null;
  authorizationStatus: IssuerAuthorizationStatus;
  authorizationLabel: string;
  technicalIdentity: AdminTechnicalIdentityVM;
  createdAtLabel: string;
}

/** Resultado de `POST /admin/issuers` (S5b). */
export interface AdminIssuerProvisionResultVM {
  issuer: AdminProvisionedIssuerVM;
  initialAdminMembership: AdminMembershipVM;
}
