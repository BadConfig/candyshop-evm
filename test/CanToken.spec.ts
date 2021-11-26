import { ethers, waffle } from "hardhat"
import { UniswapV2Factory } from "../graviton-farms-evm/graviton-periphery-evm/graviton-core-evm/typechain/UniswapV2Factory"
import { UniswapV2Pair } from "../graviton-farms-evm/graviton-periphery-evm/graviton-core-evm/typechain/UniswapV2Pair"
import { ERC20 } from "../graviton-farms-evm/graviton-periphery-evm/graviton-core-evm/typechain/ERC20"
import { UniswapV2Router02 } from "../graviton-farms-evm/graviton-periphery-evm/typechain/UniswapV2Router02"
import { WETH9 } from "../graviton-farms-evm/graviton-periphery-evm/typechain/WETH9"
import { CandyShop } from "../typechain/CandyShop"
import { Can } from "../typechain/Can"
import { candyShopFixture } from "./shared/fixtures"

import { expect } from "./shared/expect"
import { expandTo18Decimals, mineBlock } from "./shared/utils"
import { RelictGtonToken } from "~/graviton-farms-evm/typechain/RelictGtonToken"
import { BigBanger } from "~/graviton-farms-evm/typechain/BigBanger"

import { Contract, BigNumber, constants, utils } from 'ethers'
// const { AddressZero, Zero, MaxUint256 }  = constants
describe("CanToken", () => {
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
    let can: Can

    let farmId: BigNumber
    const timestamp = 1637866629
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

        farmId = await setupFarm(farm, 100, lpToken.address)
        await candy.createCan(farmId, farm.address, router.address, lpToken.address, token0.address, relict.address, 0)
        const canAddress = await candy.allCans((await candy.canLength()).sub(1))
        const canFactory = await ethers.getContractFactory("Can")
        can = canFactory.attach(canAddress) as Can
    })

    async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
        await token0.transfer(lpToken.address, token0Amount)
        await token1.transfer(lpToken.address, token1Amount)
        await lpToken.mint(wallet.address)
    }

    async function setupFarm(farm: BigBanger, allocPoints: number, lpTokenAddress: string) {
        await farm.add(allocPoints, lpTokenAddress, true)
        return await (await farm.poolLength()).sub(1);
    }

    it("constructor initializes variables", async () => {
        expect(await can.owner()).to.eq(wallet.address)
        expect(await can.feeReceiver()).to.eq(wallet.address)
        expect(await can.revertFlag()).to.eq(false)
        const info = await can.canInfo()
        expect(info.farmId).to.eq(farmId)
        expect(info.farm).to.eq(farm.address)
        expect(info.router).to.eq(router.address)
        expect(info.lpToken).to.eq(lpToken.address)
        expect(info.providingToken).to.eq(token0.address)
        expect(info.rewardToken).to.eq(relict.address)
        expect(info.fee).to.eq(0)
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

    it("emergency send to farming", async () => {
        const amount = BigNumber.from(15000000000000)
        token0.transfer(candy.address, amount)
        await expect(candy.connect(other).transferOwnership(wallet.address)).to.be.revertedWith('CandyShop: permitted to owner')
        await candy.emergencyTakeout(token0.address, other.address, amount)
        expect(await token0.balanceOf(other.address)).to.eq(amount)
        expect(await token0.balanceOf(candy.address)).to.eq(0)
        await expect(candy.emergencyTakeout(token0.address, other.address, amount.add(1))).to.be.reverted
    })

    it("emergency get from farming", async () => {
        const amount = BigNumber.from(15000000000000)
        token0.transfer(candy.address, amount)
        await expect(candy.connect(other).transferOwnership(wallet.address)).to.be.revertedWith('CandyShop: permitted to owner')
        await candy.emergencyTakeout(token0.address, other.address, amount)
        expect(await token0.balanceOf(other.address)).to.eq(amount)
        expect(await token0.balanceOf(candy.address)).to.eq(0)
        await expect(candy.emergencyTakeout(token0.address, other.address, amount.add(1))).to.be.reverted
    })

    //   it("updateCan", async () => {

    //   })

    it("burn: claim reward", async () => {
        const initialLiquidity = expandTo18Decimals(100)
        const earned = BigNumber.from("1756787588400000000")
        // in case of low liauidity throws UniswapV2Library: INSUFFICIENT_LIQUIDITY
        await addLiquidity(initialLiquidity, initialLiquidity)

        const tokenAmount1 = expandTo18Decimals(10)
        await token1.transfer(can.address, expandTo18Decimals(180000))
        await token0.approve(can.address, tokenAmount1)
        await can.mintFor(wallet.address, tokenAmount1)
        expect((await (await can.usersInfo(wallet.address)).providedAmount)).to.eq(tokenAmount1)

        await mineBlock(waffle.provider, (await waffle.provider.getBlock('latest')).timestamp + 1)
        await can.burnFor(other.address, 0, earned) // mint for someone because of dev wallet
        expect((await can.usersInfo(wallet.address)).aggregatedReward).to.eq(0)
        expect(await relict.balanceOf(other.address)).to.eq(earned)
    })

    it("burn: remove liquidity", async () => {
        const initialLiquidity = expandTo18Decimals(100)
        const earned = BigNumber.from("1756787588400000000")
        // in case of low liauidity throws UniswapV2Library: INSUFFICIENT_LIQUIDITY
        await addLiquidity(initialLiquidity, initialLiquidity)

        const tokenAmount1 = expandTo18Decimals(10)
        await token1.transfer(can.address, expandTo18Decimals(180000))
        await token0.approve(can.address, tokenAmount1)
        await can.mintFor(wallet.address, tokenAmount1)
        const token0Balance = await token0.balanceOf(other.address)
        expect((await can.usersInfo(wallet.address)).providedAmount).to.eq(tokenAmount1)
        
        await mineBlock(waffle.provider, (await waffle.provider.getBlock('latest')).timestamp + 1)
        await can.burnFor(other.address, tokenAmount1, earned) // mint for someone because of dev wallet
        expect((await can.usersInfo(wallet.address)).aggregatedReward).to.eq(0)
        expect(await relict.balanceOf(other.address)).to.eq(earned)
        expect(await token0.balanceOf(other.address)).to.eq(token0Balance.add(tokenAmount1))
    })

    // async function getQuoteForPool(lpToken: UniswapV2Pair, router: UniswapV2Router02, providingToken: string, providedAmount: BigNumber): Promise<BigNumber> {
    //     let firstToken = await lpToken.token0();
    //     let secondToken = await lpToken.token1();
    //     const { _reserve1, _reserve0 } = await lpToken.getReserves();
    //     let reserveFirst;
    //     let reserveSecond;
    //     if (secondToken == providingToken) {
    //         secondToken = firstToken;
    //         firstToken = providingToken;
    //         reserveFirst = _reserve1;
    //         reserveSecond = _reserve0;
    //     } else {
    //         reserveFirst = _reserve0;
    //         reserveSecond = _reserve1;
    //     }
    //     return router.quote(providedAmount, reserveFirst, reserveSecond);
    // }

    // it("mint: inbalanced", async () => {
    //     const initialLiquidity1 = expandTo18Decimals(100)
    //     const initialLiquidity2 = expandTo18Decimals(1000)
    //     // in case of low liauidity throws UniswapV2Library: INSUFFICIENT_LIQUIDITY
    //     await addLiquidity(initialLiquidity1, initialLiquidity2)

    //     const tokenAmount1 = expandTo18Decimals(10)
    //     const tokenAmount2 = expandTo18Decimals(145)
    //     await token1.transfer(can.address, expandTo18Decimals(180000))
    //     expect((await (await can.usersInfo(wallet.address)).providedAmount)).to.eq(0)

    //     await token0.approve(can.address, tokenAmount1)
    //     await can.mintFor(wallet.address, tokenAmount1)
    //     expect((await (await can.usersInfo(wallet.address)).providedAmount)).to.eq(tokenAmount1)

    //     await mineBlock(waffle.provider, (await waffle.provider.getBlock('latest')).timestamp + 1)
    //     await can.updateCan()
    //     // accumulated reward per share
    //     expect((await can.canInfo()).accRewardPerShare).to.eq(175678758838)
    //     // test with another user
    //     await token0.transfer(other.address, tokenAmount2)
    //     await token0.connect(other).approve(can.address, tokenAmount2)
    //     await can.connect(other).mintFor(other.address, tokenAmount2)
    //     expect((await can.canInfo()).totalProvidedTokenAmount).to.eq(tokenAmount1.add(tokenAmount2))
    //     expect((await can.canInfo()).accRewardPerShare).to.eq(439196897098)
    //     expect((await can.usersInfo(other.address)).providedAmount).to.eq(tokenAmount2)
    //     expect((await can.usersInfo(other.address)).aggregatedReward).to.eq(201385067735700007069)
    // })

    it("mint: balanced", async () => {
        const initialLiquidity = expandTo18Decimals(100)
        // in case of low liauidity throws UniswapV2Library: INSUFFICIENT_LIQUIDITY
        await addLiquidity(initialLiquidity, initialLiquidity)

        const tokenAmount1 = expandTo18Decimals(10)
        const tokenAmount2 = expandTo18Decimals(145)
        await token1.transfer(can.address, expandTo18Decimals(180000))
        expect((await (await can.usersInfo(wallet.address)).providedAmount)).to.eq(0)

        await token0.approve(can.address, tokenAmount1)
        await can.mintFor(wallet.address, tokenAmount1)
        expect((await (await can.usersInfo(wallet.address)).providedAmount)).to.eq(tokenAmount1)
        expect((await can.usersInfo(wallet.address)).aggregatedReward).to.eq("0")

        await mineBlock(waffle.provider, (await waffle.provider.getBlock('latest')).timestamp + 1)
        await can.updateCan()

        // accumulated reward per share
        expect((await can.canInfo()).accRewardPerShare).to.eq(175678758840)

        // test with another user
        await token0.transfer(other.address, tokenAmount2)
        await token0.connect(other).approve(can.address, tokenAmount2)
        await can.connect(other).mintFor(other.address, tokenAmount2)
        expect((await can.canInfo()).totalProvidedTokenAmount).to.eq(tokenAmount1.add(tokenAmount2))
        expect((await can.canInfo()).accRewardPerShare).to.eq(439196897101)
        expect((await can.usersInfo(other.address)).providedAmount).to.eq(tokenAmount2)
        expect((await can.usersInfo(other.address)).aggregatedReward).to.eq("63683550079645000000")
        expect((await can.usersInfo(wallet.address)).aggregatedReward).to.eq("0") // wallet will have 0 reward until  burnfor(address, 0, 0)
    })

    it("transfer", async () => {

    })
})
