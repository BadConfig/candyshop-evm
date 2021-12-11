//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "./interfaces/ICan.sol";
import "./libraries/AddressArrayLibrary.sol";

contract Can is ICan {
    
    struct UserTokenData {
        uint providedAmount;
        uint farmingAmount;
        uint rewardDebt;
        uint aggregatedReward;
    }
    
    struct CanData {
        uint totalProvidedTokenAmount;
        uint totalFarmingTokenAmount;
        uint accRewardPerShare;
        uint totalRewardsClaimed;
        uint farmId;
        IFarmProxy farm;
        IPoolProxy router;
        IPoolPair lpToken;
        IERC20 providingToken;
        IERC20 rewardToken;
        uint fee;
    }
    
    bool public revertFlag;
    address public owner;
    address[] public lpAdmins;
    address public feeReceiver;  

    constructor(
        address _owner,
        address _feeReceiver,
        uint _farmId,
        address _farm,
        address _router,
        address _lpToken,
        address _providingToken,
        address _rewardToken,
        uint _fee
    ) {
        owner = _owner;
        revertFlag = false;
        feeReceiver = _feeReceiver;
        canInfo.farmId = _farmId;
        canInfo.farm = IFarmProxy(_farm);
        canInfo.router = IPoolProxy(_router);
        canInfo.lpToken = IPoolPair(_lpToken);
        canInfo.providingToken = IERC20(_providingToken);
        canInfo.rewardToken = IERC20(_rewardToken);
        canInfo.fee = _fee;
    }
    
    modifier onlyOwner() {
        require(msg.sender==owner,'CanToken: permitted to owner only');
        _;
    }

    modifier onlyLPAdmin() {
        require(msg.sender==owner || AddressArrayLib.indexOf(lpAdmins, msg.sender) != -1,'CanToken: permitted to admins only');
        _;
    }
    
    modifier notReverted() {
        require(!revertFlag,'CanToken: Option is closed to use');
        _;
    }
    // careful use:
    function setAdmins(address[] memory admins) public onlyOwner {
        for(uint i = 0; i < admins.length; i++) {
            lpAdmins.push(admins[i]);
        }
    }

    function removeAdmins(address[] memory admins) public onlyOwner {
        for(uint i = 0; i < admins.length; i++) {
            AddressArrayLib.removeItem(lpAdmins, admins[i]);
        }
    }

    function toggleRevert() public override onlyOwner {
        revertFlag = !revertFlag;
    }
    
    function transferOwnership(address newOwner) public override onlyOwner {
        owner = newOwner;
    }
    
    function emergencyTakeout(IERC20 _token, address _to, uint _amount) public override onlyOwner {
        require(_token.transfer(_to,_amount),"error");
    }

    function emergencySendToFarming(uint _amount) public override onlyLPAdmin {
        require(canInfo.lpToken.approve(address(canInfo.farm),_amount),"CanToken: Insufficent approve");
        canInfo.farm.deposit(canInfo.farmId,_amount);
    }
    
    function emergencyGetFromFarming(uint _amount) public override onlyLPAdmin {
        CanData storage canData = canInfo;
        uint pendingAmount = canData.farm.pendingRelict(canData.farmId,address(this));
        canData.farm.withdraw(canData.farmId,_amount);
        canData.accRewardPerShare += pendingAmount * 1e12 / canData.totalProvidedTokenAmount;
    }
    
    CanData public canInfo;
    mapping (address => UserTokenData) public usersInfo;
    
    function changeCanFee(uint _fee) public override onlyOwner {
        canInfo.fee = _fee;
    }
    
    function updateCan() public override notReverted {
        CanData storage canData = canInfo;
        uint pendingAmount = canData.farm.pendingRelict(canData.farmId,address(this));
        canData.farm.withdraw(canData.farmId,0);
        if(canData.totalProvidedTokenAmount > 0) {
           canData.accRewardPerShare += pendingAmount * 1e12 / canData.totalProvidedTokenAmount;         
        }
    }

    // creates some can tokens for user in declared stack
    function mintFor(address _user, uint _providedAmount) public override notReverted {
        // getting user and stack info from mappings
        UserTokenData storage userTokenData = usersInfo[msg.sender];
        CanData storage canData = canInfo;
        updateCan();
        
        // get second token amount for liquidity
        address firstToken = canData.lpToken.token0();
        address secondToken = canData.lpToken.token1();
        (uint reserve0, uint reserve1,) = canData.lpToken.getReserves();
        uint reserveFirst;
        uint reserveSecond;
        if (secondToken == address(canData.providingToken)) {
            secondToken = firstToken;
            firstToken = address(canData.providingToken);
            reserveFirst = reserve1;
            reserveSecond = reserve0;
        } else {
            reserveFirst = reserve0;
            reserveSecond = reserve1;  
        }
        uint secondTokenAmount = canData.router.quote(_providedAmount,reserveFirst,reserveSecond);
        // approve tokens for liquidity
        require(IERC20(firstToken).transferFrom(msg.sender,address(this),_providedAmount),"CanToken: error transfer from");
        
        require(IERC20(firstToken).approve(address(canData.router),_providedAmount),"CanToken: Insufficent approve t0");
        require(IERC20(secondToken).approve(address(canData.router),secondTokenAmount),"CanToken: Insufficent approve t1");
        
        uint providingAmount = _providedAmount;
        // send liquidity and get lp amount
        (,,uint lpAmount) = canData.router.addLiquidity(
            firstToken,
            secondToken,
            providingAmount,
            secondTokenAmount,
            providingAmount,
            secondTokenAmount,
            address(this),
            block.timestamp + 10000
        );
        // send lp tokens to farming
        require(IERC20(address(canData.lpToken)).approve(address(canData.farm),lpAmount),"CanToken: Insufficent approve lp"); 
        canData.farm.deposit(canData.farmId,lpAmount);
    
        // previous pending reward goes to aggregated reward
        userTokenData.aggregatedReward = lpAmount * canData.accRewardPerShare / 1e12 - userTokenData.rewardDebt;
        // incrementing provided and lp amount
        userTokenData.providedAmount += _providedAmount;
        userTokenData.farmingAmount += lpAmount;
        // updating reward reward debt
        userTokenData.rewardDebt = userTokenData.providedAmount * canData.accRewardPerShare / 1e12;
        canData.totalProvidedTokenAmount += _providedAmount;
        canData.totalFarmingTokenAmount += lpAmount;
    }
    
    
    // creates some can tokens for user in declared stack
    function burnFor(address _user, uint _providedAmount, uint _rewardAmount) public override notReverted {
        // getting user and stack info from mappings
        UserTokenData storage userTokenData = usersInfo[msg.sender];
        CanData storage canData = canInfo;
        updateCan();
        
        // get token adresses from pair
        address firstToken = canData.lpToken.token0();
        address secondToken = canData.lpToken.token1();
        (uint reserve0, uint reserve1,) = canData.lpToken.getReserves();
        uint reserveFirst;
        uint reserveSecond;
        if (secondToken == address(canData.providingToken)) {
            secondToken = firstToken;
            firstToken = address(canData.providingToken);
            reserveFirst = reserve1;
            reserveSecond = reserve0;
        } else {
            reserveFirst = reserve0;
            reserveSecond = reserve1;  
        }
        
        // calculate lp amount
        require(_providedAmount <= userTokenData.providedAmount, "CanToken: Insufficent provided amount");
        // aggregate rewards  and transfer
        userTokenData.aggregatedReward += userTokenData.farmingAmount * canData.accRewardPerShare / 1e12 - userTokenData.rewardDebt;
        require(_rewardAmount <= userTokenData.aggregatedReward, "CanToken: Insufficent reward amount");
        require(canData.rewardToken.transfer(_user,(_rewardAmount - canData.fee)),'CanToken: Reward transfer error');
        // transfer fee 
        require(canData.rewardToken.transfer(feeReceiver,canData.fee),'CanToken: Fee transfer error');
        userTokenData.aggregatedReward -= _rewardAmount;
        canData.totalRewardsClaimed += _rewardAmount;
        // prevent stack too deep
        uint providingAmount = _providedAmount;
            
         if(_providedAmount > 0) {
       
            uint lpAmountToTakeFromPool = _providedAmount * canData.lpToken.totalSupply() / reserveFirst;
            canData.farm.withdraw(canData.farmId, lpAmountToTakeFromPool);
            require(canData.lpToken.approve(address(canData.router), lpAmountToTakeFromPool), "CanToken: Cannot approve to withdraw");
            (uint amountFirst,) = canData.router.removeLiquidity(
            address(canData.providingToken),
            secondToken,
            lpAmountToTakeFromPool,
            providingAmount,
            0,
            address(this),
            block.timestamp + 10000
            );
            
            require(IERC20(address(canData.providingToken)).transfer(_user,amountFirst),'CanToken: Error transfering provided token');
            // better update farming before prov amount
            userTokenData.farmingAmount = (userTokenData.providedAmount - _providedAmount) * canData.lpToken.totalSupply() / reserveFirst;
            userTokenData.providedAmount -= _providedAmount;

            canData.totalProvidedTokenAmount -= _providedAmount;
            canData.totalFarmingTokenAmount -= lpAmountToTakeFromPool;
         }
         
        userTokenData.rewardDebt = userTokenData.farmingAmount * canData.accRewardPerShare / 1e12;
    }
    
    function transfer(address _to, uint _providingAmount, uint _rewardAmount) public override notReverted {
        // Should we add require(sender == _to, "cannot transfer to the same account")
        UserTokenData storage from_data = usersInfo[msg.sender];       
        UserTokenData storage to_data = usersInfo[_to];
        CanData storage canData = canInfo;
        updateCan();
        
        require(_providingAmount <= from_data.providedAmount, "CanToken: Insufficent provided amount");
        uint farmingDelta = _providingAmount * from_data.farmingAmount / from_data.providedAmount;
        
        from_data.aggregatedReward += from_data.farmingAmount * canData.accRewardPerShare / 1e12 - from_data.rewardDebt;
        to_data.aggregatedReward += to_data.farmingAmount * canData.accRewardPerShare / 1e12 - to_data.rewardDebt;
       
        require(_rewardAmount <= from_data.aggregatedReward, "CanToken: Insufficent reward amount"); 
        to_data.aggregatedReward += _rewardAmount;
        from_data.aggregatedReward -= _rewardAmount;

        // decrementing provided and lp amount and aggregatedReward
        from_data.providedAmount -= _providingAmount;
        from_data.farmingAmount -= farmingDelta;
        
        to_data.providedAmount += _providingAmount;
        to_data.farmingAmount += farmingDelta;
        
        // updating reward reward debt
        from_data.rewardDebt = from_data.farmingAmount * canData.accRewardPerShare / 1e12;
        to_data.rewardDebt = to_data.farmingAmount * canData.accRewardPerShare / 1e12;
    }
    
}
