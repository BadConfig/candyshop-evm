import { ethers } from "hardhat"
import { BytesLike, ContractFactory, BigNumber } from "ethers"

export async function getFactory({
  abi,
  bytecode,
}: {
  abi: any[]
  bytecode: BytesLike
}): Promise<ContractFactory> {
  return await ethers.getContractFactory(abi, bytecode)
}
export async function mineBlock(provider: any, timestamp: number): Promise<void> {
  await provider.send("evm_setNextBlockTimestamp", [timestamp])
  await provider.send("evm_mine")
}
export function expandTo18Decimals(n: number): BigNumber {
  return BigNumber.from(n).mul(BigNumber.from(10).pow(18))
}