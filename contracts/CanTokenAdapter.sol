//SPDX-License-Identifier: MIT
pragma solidity 0.8.0;

import "./interfaces/ICan.sol";
import "./libraries/AddressArrayLibrary.sol";

contract Can is ICan {
    
    struct CanData {
        uint farmId;
        IFarmProxy farm;
        IPoolProxy router;
        IPoolPair lpToken;
        IERC20 providingToken;
        IERC20 rewardToken;
    }
    
    bool public revertFlag;
    address public owner;
    address[] public lpAdmins;

    constructor(
        address _owner,
        uint _farmId,
        address _farm,
        address _router,
        address _lpToken,
        address _providingToken,
        address _rewardToken
    ) {
        owner = _owner;
        revertFlag = false;
        canInfo.farmId = _farmId;
        canInfo.farm = IFarmProxy(_farm);
        canInfo.router = IPoolProxy(_router);
        canInfo.lpToken = IPoolPair(_lpToken);
        canInfo.providingToken = IERC20(_providingToken);
        canInfo.rewardToken = IERC20(_rewardToken);
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
        canData.farm.withdraw(canData.farmId,_amount);
    }
    
    CanData public canInfo;
    
    function changeCanFee(uint _fee) public override onlyOwner {
    }

    // creates some can tokens for user in declared stack
    function mintFor(address _user, uint _providedAmount) public override notReverted {
        CanData storage canData = canInfo;
        
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
    }

    function burnFor(address _user, uint _providedAmount, uint _rewardAmount) public override notReverted {}
    function updateCan() public override notReverted {}
    function transfer(address _to, uint _providingAmount, uint _rewardAmount) public override notReverted {}
}
