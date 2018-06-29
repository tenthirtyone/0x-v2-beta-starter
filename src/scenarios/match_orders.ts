// Ensure you have linked the latest source via yarn link and are not pulling from NPM for the packages
import { assetProxyUtils, generatePseudoRandomSalt, orderHashUtils } from '@0xProject/order-utils';
import { Order, SignatureType } from '@0xproject/types';
import { BigNumber } from '@0xproject/utils';
import { Web3Wrapper } from '@0xproject/web3-wrapper';
import { NULL_ADDRESS, TX_DEFAULTS, UNLIMITED_ALLOWANCE_IN_BASE_UNITS, ZERO } from '../constants';
import {
    erc20ProxyAddress,
    etherTokenContract,
    exchangeContract,
    mnemonicWallet,
    providerEngine,
    zrxTokenContract,
} from '../contracts';
import {
    fetchAndPrintAllowancesAsync,
    fetchAndPrintBalancesAsync,
    printData,
    printScenario,
    printTransaction,
} from '../print_utils';
import { signingUtils } from '../signing_utils';

const web3Wrapper = new Web3Wrapper(providerEngine);
web3Wrapper.abiDecoder.addABI(exchangeContract.abi);
web3Wrapper.abiDecoder.addABI(zrxTokenContract.abi);

async function scenario() {
    printScenario('Match Orders');
    const accounts = await web3Wrapper.getAvailableAddressesAsync();
    const maker = accounts[0];
    const taker = accounts[1];
    const matcherAccount = accounts[2];
    printData('Accounts', [['Maker', maker], ['Taker', taker], ['Order Matcher', matcherAccount]]);

    // the amount the maker is selling in maker asset
    const makerAssetAmount = new BigNumber(10);
    // the amount the maker is wanting in taker asset
    const takerAssetAmount = new BigNumber(4);
    // 0x v2 uses asset data to encode the correct proxy type and additional parameters
    const makerAssetData = assetProxyUtils.encodeERC20AssetData(zrxTokenContract.address);
    const takerAssetData = assetProxyUtils.encodeERC20AssetData(etherTokenContract.address);
    let txHash;
    let txReceipt;

    // Approve the new ERC20 Proxy to move ZRX for makerAccount
    const makerZRXApproveTxHash = await zrxTokenContract.approve.sendTransactionAsync(
        erc20ProxyAddress,
        UNLIMITED_ALLOWANCE_IN_BASE_UNITS,
        {
            from: maker,
        },
    );
    txReceipt = await web3Wrapper.awaitTransactionMinedAsync(makerZRXApproveTxHash);

    // Approve the new ERC20 Proxy to move WETH for takerAccount
    const takerWETHApproveTxHash = await etherTokenContract.approve.sendTransactionAsync(
        erc20ProxyAddress,
        UNLIMITED_ALLOWANCE_IN_BASE_UNITS,
        {
            from: taker,
        },
    );
    txReceipt = await web3Wrapper.awaitTransactionMinedAsync(takerWETHApproveTxHash);

    // Deposit ETH into WETH for the taker
    const takerWETHDepositTxHash = await etherTokenContract.deposit.sendTransactionAsync({
        from: taker,
        value: takerAssetAmount,
    });
    txReceipt = await web3Wrapper.awaitTransactionMinedAsync(takerWETHDepositTxHash);

    printData('Setup', [
        ['Maker ZRX Approval', makerZRXApproveTxHash],
        ['Taker WETH Approval', takerWETHApproveTxHash],
        ['Taker WETH Deposit', takerWETHDepositTxHash],
    ]);

    // Set up the Order and fill it
    const tenMinutes = 10 * 60 * 1000;
    const randomExpiration = new BigNumber(Date.now() + tenMinutes);

    // Create the order
    const leftOrder = {
        exchangeAddress: exchangeContract.address,
        makerAddress: maker,
        takerAddress: NULL_ADDRESS,
        senderAddress: NULL_ADDRESS,
        feeRecipientAddress: NULL_ADDRESS,
        expirationTimeSeconds: randomExpiration,
        salt: generatePseudoRandomSalt(),
        makerAssetAmount,
        takerAssetAmount,
        makerAssetData,
        takerAssetData,
        makerFee: ZERO,
        takerFee: ZERO,
    } as Order;
    printData('Left Order', Object.entries(leftOrder));

    // Create the matched order
    const rightOrderTakerAssetAmount = new BigNumber(2);
    const rightOrder = {
        exchangeAddress: exchangeContract.address,
        makerAddress: taker,
        takerAddress: NULL_ADDRESS,
        senderAddress: NULL_ADDRESS,
        feeRecipientAddress: NULL_ADDRESS,
        expirationTimeSeconds: randomExpiration,
        salt: generatePseudoRandomSalt(),
        makerAssetAmount: leftOrder.takerAssetAmount,
        takerAssetAmount: rightOrderTakerAssetAmount,
        makerAssetData: leftOrder.takerAssetData,
        takerAssetData: leftOrder.makerAssetData,
        makerFee: ZERO,
        takerFee: ZERO,
    } as Order;
    printData('Right Order', Object.entries(rightOrder));

    // Create the order hash and signature
    const leftOrderHashBuffer = orderHashUtils.getOrderHashBuffer(leftOrder);
    const leftOrderHashHex = `0x${leftOrderHashBuffer.toString('hex')}`;
    const leftSignatureBuffer = await signingUtils.signMessageAsync(
        leftOrderHashBuffer,
        maker,
        mnemonicWallet,
        SignatureType.EthSign,
    );
    const leftSignature = `0x${leftSignatureBuffer.toString('hex')}`;

    // Create the matched order hash and signature
    const rightOrderHashBuffer = orderHashUtils.getOrderHashBuffer(rightOrder);
    const rightOrderHashHex = `0x${rightOrderHashBuffer.toString('hex')}`;
    const rightSignatureBuffer = await signingUtils.signMessageAsync(
        rightOrderHashBuffer,
        taker,
        mnemonicWallet,
        SignatureType.EthSign,
    );
    const rightSignature = `0x${rightSignatureBuffer.toString('hex')}`;

    // Print out the Balances and Allowances
    await fetchAndPrintAllowancesAsync({ maker, taker }, [zrxTokenContract, etherTokenContract], erc20ProxyAddress);
    await fetchAndPrintBalancesAsync({ maker, taker, matcherAccount }, [zrxTokenContract, etherTokenContract]);

    txHash = await exchangeContract.matchOrders.sendTransactionAsync(
        leftOrder,
        rightOrder,
        leftSignature,
        rightSignature,
        {
            ...TX_DEFAULTS,
            from: matcherAccount,
        },
    );

    txReceipt = await web3Wrapper.awaitTransactionMinedAsync(txHash);
    printTransaction('matchOrders', txReceipt, [
        ['left orderHash', leftOrderHashHex],
        ['right orderHash', rightOrderHashHex],
    ]);

    // Print the Balances
    await fetchAndPrintBalancesAsync({ maker, taker, matcherAccount }, [zrxTokenContract, etherTokenContract]);

    // Stop the Provider Engine
    providerEngine.stop();
}

(async () => {
    try {
        await scenario();
    } catch (e) {
        console.log(e);
        providerEngine.stop();
    }
})();