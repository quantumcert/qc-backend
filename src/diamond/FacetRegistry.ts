// ═══════════════════════════════════════════════════════════
// DIAMOND PATTERN - FACET REGISTRY
// Maintains the internal routing table linking "selectors"
// (similar to 4-byte hashes in Solidity) to pure Facet functions.
// ═══════════════════════════════════════════════════════════

import { AssetRegistryFacet } from '../services/core-facets/AssetRegistryFacet';
import { EventLogFacet } from '../services/core-facets/EventLogFacet';
import { ContextRouterFacet } from '../services/core-facets/ContextRouterFacet';
import { BlindContactLogFacet } from '../services/core-facets/BlindContactLogFacet';
import { PublicProfileFacet } from '../services/core-facets/PublicProfileFacet';
import { DeviceRegistryFacet } from '../services/core-facets/DeviceRegistryFacet';
import { DeviceGuardFacet } from '../services/core-facets/DeviceGuardFacet';
import { LifecycleFacet } from '../services/core-facets/LifecycleFacet';
import { TransferRegistryFacet } from '../services/core-facets/TransferRegistryFacet';
import { CommissioningFacet } from '../services/core-facets/CommissioningFacet';
import { AgentRegistryFacet } from '../services/core-facets/AgentRegistryFacet';
import { EscrowFacet } from '../services/core-facets/EscrowFacet';
import { DocumentVerificationFacet } from '../services/core-facets/DocumentVerificationFacet';
import { ERecycleFacet } from '../services/core-facets/ERecycleFacet';


export type FacetFunction = (...args: any[]) => Promise<any> | any;

export const FacetRegistry: Record<string, FacetFunction> = {
    // HARDWARE PROVISIONING
    'device.register': DeviceRegistryFacet.registerDevice,
    'device.validateTap': DeviceGuardFacet.validateAndRecordTap,
    // ASSET REGISTRY
    'asset.create': AssetRegistryFacet.createAsset,
    'asset.get': AssetRegistryFacet.getAsset,
    'asset.list': AssetRegistryFacet.listAssets,
    'asset.update': AssetRegistryFacet.updateAsset,
    'asset.addOwner': AssetRegistryFacet.addOwner,
    'asset.revokeOwner': AssetRegistryFacet.revokeOwner,
    'asset.acceptOwner': AssetRegistryFacet.acceptOwner,

    // EVENT LOG
    'event.recordAuthenticated': EventLogFacet.recordAuthenticatedEvent,
    'event.suggestPublic': EventLogFacet.suggestPublicEvent,
    'event.review': EventLogFacet.reviewEvent,

    // CONTEXT ROUTER
    'context.routeAssetRead': ContextRouterFacet.routeAssetRead,

    // BLIND CONTACT
    'blindContact.submit': BlindContactLogFacet.submitContact,

    // PUBLIC PROFILE
    'publicProfile.filter': PublicProfileFacet.filterAsset,

    // LIFECYCLE STATE MACHINE
    'lifecycle.transition': LifecycleFacet.transition,

    // TRANSFER REGISTRY
    'transfer.initiate': TransferRegistryFacet.initiateTransfer,

    // QTAG COMMISSIONING
    'commissioning.start': CommissioningFacet.start,
    'commissioning.confirm': CommissioningFacet.confirm,
    'commissioning.status': CommissioningFacet.statusQuery,

    // AGENT REGISTRY (M2M / IoT)
    'agent.register': AgentRegistryFacet.register,
    'agent.revoke': AgentRegistryFacet.revoke,
    'agent.status': AgentRegistryFacet.status,

    // ESCROW TIME-LOCK
    'escrow.lock':    (ctx: any, payload: any) => EscrowFacet.lock(ctx, payload),
    'escrow.release': (ctx: any, payload: any) => EscrowFacet.release(ctx, payload),
    'escrow.cancel':  (ctx: any, payload: any) => EscrowFacet.cancel(ctx, payload),
    'escrow.status':  (ctx: any, payload: any) => EscrowFacet.getStatus(ctx, payload),

    // DOCUMENT VERIFICATION (public — ctx is ignored, only payload.hash is used)
    'document.verify': (_ctx: any, payload: any) => DocumentVerificationFacet.verifyByHash(payload.hash),

    // ERE CYCLE (ERecycleFacet)
    'erecycle.recordWaste': (ctx: any, payload: any) => ERecycleFacet.recordWaste(ctx, payload),
    'erecycle.issueCredit': (ctx: any, payload: any) => ERecycleFacet.issueCredit(ctx, payload),
};
