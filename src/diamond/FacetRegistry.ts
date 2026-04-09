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

    // EVENT LOG
    'event.recordAuthenticated': EventLogFacet.recordAuthenticatedEvent,
    'event.suggestPublic': EventLogFacet.suggestPublicEvent,
    'event.review': EventLogFacet.reviewEvent,

    // CONTEXT ROUTER
    'context.routeAssetRead': ContextRouterFacet.routeAssetRead,

    // BLIND CONTACT
    'blindContact.submit': BlindContactLogFacet.submitContact,

    // PUBLIC PROFILE
    'publicProfile.filter': PublicProfileFacet.filterAsset
};
