/**
 * Sparse Merkle Tree for ZK Anonymous Membership Proofs
 * 
 * Supports:
 * - Configurable depth (default: 20, capacity: 2^20 ≈ 1M members)
 * - Incremental leaf insertion
 * - Merkle path generation for proof construction
 * - Serialization/deserialization to JSON
 * - Efficient sparse storage (only populated nodes stored)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

// Type definitions
export type HashHex = string;
export const TREE_DEPTH = 20;

export interface MerklePath {
  siblings: HashHex[];
  pathIndices: number[];
}

export interface MerkleTreeData {
  depth: number;
  leafCount: number;
  leaves: HashHex[];
  layers: Record<number, Record<number, HashHex>>;
  root: HashHex;
}

// Poseidon hash simulation (in production, use the actual Poseidon implementation)
export function poseidonHash(input: string): HashHex {
  return createHash('sha256').update(input).digest('hex');
}

export function hashLeaf(secret: string): HashHex {
  return poseidonHash(`leaf:${secret}`);
}

export function hashNode(left: HashHex, right: HashHex): HashHex {
  return poseidonHash(`node:${left}:${right}`);
}

export function computeZeroHashes(depth: number): HashHex[] {
  const zeros: HashHex[] = [];
  zeros[0] = poseidonHash('zero:0');
  
  for (let i = 1; i <= depth; i++) {
    zeros[i] = hashNode(zeros[i - 1], zeros[i - 1]);
  }
  
  return zeros;
}

export class MerkleTree {
  readonly depth: number;
  private leaves: HashHex[] = [];
  private layers: Map<number, Map<number, HashHex>> = new Map();
  private zeroHashes: HashHex[];

  constructor(depth: number = TREE_DEPTH) {
    this.depth = depth;
    this.zeroHashes = computeZeroHashes(depth);

    for (let i = 0; i <= depth; i++) {
      this.layers.set(i, new Map());
    }
  }

  get leafCount(): number {
    return this.leaves.length;
  }

  get capacity(): number {
    return 2 ** this.depth;
  }

  get root(): HashHex {
    return this.getNode(this.depth, 0);
  }

  private getNode(level: number, index: number): HashHex {
    const layer = this.layers.get(level);
    if (layer?.has(index)) {
      return layer.get(index)!;
    }
    return this.zeroHashes[level];
  }

  private setNode(level: number, index: number, hash: HashHex): void {
    let layer = this.layers.get(level);
    if (!layer) {
      layer = new Map();
      this.layers.set(level, layer);
    }
    layer.set(index, hash);
  }

  insertLeaf(leafHash: HashHex): number {
    if (this.leaves.length >= this.capacity) {
      throw new Error(`Tree is full (capacity: ${this.capacity})`);
    }

    const leafIndex = this.leaves.length;
    this.leaves.push(leafHash);
    this.setNode(0, leafIndex, leafHash);

    let currentIndex = leafIndex;
    for (let level = 0; level < this.depth; level++) {
      const parentIndex = Math.floor(currentIndex / 2);
      const leftChild = this.getNode(level, parentIndex * 2);
      const rightChild = this.getNode(level, parentIndex * 2 + 1);
      const parentHash = hashNode(leftChild, rightChild);
      this.setNode(level + 1, parentIndex, parentHash);
      currentIndex = parentIndex;
    }

    return leafIndex;
  }

  addMember(secret: string): { leaf: HashHex; index: number } {
    const leaf = hashLeaf(secret);
    const index = this.insertLeaf(leaf);
    return { leaf, index };
  }

  generateMerkleProof(leafIndex: number): MerklePath {
    if (leafIndex >= this.leaves.length) {
      throw new Error(`Leaf index ${leafIndex} out of range (have ${this.leaves.length})`);
    }

    const siblings: HashHex[] = [];
    const pathIndices: number[] = [];
    let currentIndex = leafIndex;

    for (let level = 0; level < this.depth; level++) {
      const isRight = currentIndex % 2 === 1;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;
      
      siblings.push(this.getNode(level, siblingIndex));
      pathIndices.push(isRight ? 1 : 0);
      
      currentIndex = Math.floor(currentIndex / 2);
    }

    return { siblings, pathIndices };
  }

  verifyProof(leafHash: HashHex, proof: MerklePath): boolean {
    let computedRoot = leafHash;
    
    for (let level = 0; level < this.depth; level++) {
      const isRight = proof.pathIndices[level] === 1;
      if (isRight) {
        computedRoot = hashNode(proof.siblings[level], computedRoot);
      } else {
        computedRoot = hashNode(computedRoot, proof.siblings[level]);
      }
    }

    return computedRoot === this.root;
  }

  findLeafIndex(leafHash: HashHex): number {
    return this.leaves.indexOf(leafHash);
  }

  toJSON(): MerkleTreeData {
    const layersObj: Record<number, Record<number, HashHex>> = {};
    for (const [level, layer] of this.layers.entries()) {
      layersObj[level] = Object.fromEntries(layer.entries());
    }

    return {
      depth: this.depth,
      leafCount: this.leaves.length,
      leaves: this.leaves,
      layers: layersObj,
      root: this.root,
    };
  }

  static fromJSON(data: MerkleTreeData): MerkleTree {
    const tree = new MerkleTree(data.depth);
    tree.leaves = data.leaves;

    for (const [levelStr, layerObj] of Object.entries(data.layers)) {
      const level = parseInt(levelStr, 10);
      const layer = new Map<number, HashHex>();
      for (const [indexStr, hash] of Object.entries(layerObj)) {
        layer.set(parseInt(indexStr, 10), hash);
      }
      tree.layers.set(level, layer);
    }

    return tree;
  }

  save(filePath: string = 'data/tree.json'): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(this.toJSON(), null, 2));
  }

  static load(filePath: string): MerkleTree {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return MerkleTree.fromJSON(data);
  }
}
