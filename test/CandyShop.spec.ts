import { waffle } from "hardhat"
import { UniswapV2Factory } from "../graviton-farms-evm/graviton-periphery-evm/graviton-core-evm/typechain/UniswapV2Factory"
import { UniswapV2Pair } from "../graviton-farms-evm/graviton-periphery-evm/graviton-core-evm/typechain/UniswapV2Pair"
import { ERC20 } from "../graviton-farms-evm/graviton-periphery-evm/graviton-core-evm/typechain/ERC20"
import { UniswapV2Router02 } from "../graviton-farms-evm/graviton-periphery-evm/typechain/UniswapV2Router02"
import { WETH9 } from "../graviton-farms-evm/graviton-periphery-evm/typechain/WETH9"
import { CandyShop } from "../typechain/CandyShop"
import { candyShopFixture } from "./shared/fixtures"

import { expect } from "./shared/expect"
import { RelictGtonToken } from "~/graviton-farms-evm/typechain/RelictGtonToken"
import { BigBanger } from "~/graviton-farms-evm/typechain/BigBanger"

import { BigNumber, utils } from 'ethers'
describe("CandyShop", () => {
  const [wallet, other, nebula] = waffle.provider.getWallets()

  let loadFixture: ReturnType<typeof waffle.createFixtureLoader>

  before("create fixture loader", async () => {
    loadFixture = waffle.createFixtureLoader([wallet, other, nebula], waffle.provider)
  })

  let weth: WETH9
  let token0: ERC20
  let token1: ERC20
  let token2: ERC20
  let factory: UniswapV2Factory
  let lpToken: UniswapV2Pair
  let router: UniswapV2Router02
  let relict: RelictGtonToken
  let farm: BigBanger
  let candy: CandyShop

  beforeEach("deploy test contracts", async () => {
    ; ({
      weth,
      token0,
      token1,
      token2,
      factory,
      router,
      relict,
      farm,
      lpToken,
      candy
    } = await loadFixture(candyShopFixture))
  })

  async function setupFarm(farm: BigBanger, allocPoints: number, lpTokenAddress: string) {
    await farm.add(allocPoints, lpTokenAddress, true)
    return await (await farm.poolLength()).sub(1);
  }
  it("constructor initializes variables", async () => {
    expect(await candy.owner()).to.eq(wallet.address)
    expect(await candy.revertFlag()).to.eq(false)
  })

  it("can creation", async () => {
    const farmId: BigNumber = await setupFarm(farm, 100, lpToken.address)
    // check revert modifier
    await candy.toggleRevert()
    await expect(candy.createCan(farmId, farm.address, router.address, lpToken.address, token0.address, relict.address, 0)).to.be.revertedWith('CandyShop: Option is closed to use')
    await candy.toggleRevert()
    // check ownership
    await expect(candy.connect(other).createCan(farmId, farm.address, router.address, lpToken.address, token0.address, relict.address, 0)).to.be.revertedWith('CandyShop: permitted to owner')
    
    await candy.createCan(farmId, farm.address, router.address, lpToken.address, token0.address, relict.address, 0)
    // check for correct enpacked address
    const key = utils.solidityPack(["uint","address","address","address","address",], [farmId, farm.address, lpToken.address, token0.address, relict.address])
    const canAddress = await candy.allCans((await candy.canLength()).sub(1))
    const canKeyAddress = await candy.canContracts(key)
    expect(canAddress).to.eq(canKeyAddress)
    // check for already existing can
    await expect(candy.createCan(farmId, farm.address, router.address, lpToken.address, token0.address, relict.address, 0)).to.be.revertedWith(
      "CandyShop: Can exists"
    )
  })

  it("transfer ownership", async () => {
    await expect(candy.connect(other).transferOwnership(wallet.address)).to.be.revertedWith('CandyShop: permitted to owner')
    await candy.transferOwnership(other.address)
    expect(await candy.owner()).to.eq(other.address)
  })

  it("emergency takeout", async () => {
    const amount = BigNumber.from(15000000000000)
    token0.transfer(candy.address, amount)
    await expect(candy.connect(other).transferOwnership(wallet.address)).to.be.revertedWith('CandyShop: permitted to owner')
    await candy.emergencyTakeout(token0.address, other.address, amount)
    expect(await token0.balanceOf(other.address)).to.eq(amount)
    expect(await token0.balanceOf(candy.address)).to.eq(0)
    await expect(candy.emergencyTakeout(token0.address, other.address, amount.add(1))).to.be.reverted
  })
})
