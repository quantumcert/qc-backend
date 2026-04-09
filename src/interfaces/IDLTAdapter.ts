export interface IDLTAdapter {
    /**
     * Anchors an event payload hash to the blockchain/DLT.
     * @param eventId The local event ID
     * @param hash The SHA-256 hash of the payload
     * @returns A promise resolving to the transaction ID (TxID) on the DLT
     */
    anchorEvent(eventId: string, hash: string): Promise<string>;

    /**
     * Verifies if an anchor associated with a TxID is mathematically valid and exists on the ledger.
     * @param txId The transaction ID on the DLT
     */
    verifyAnchor(txId: string): Promise<boolean>;
}
